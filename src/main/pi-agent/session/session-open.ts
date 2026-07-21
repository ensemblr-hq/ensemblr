import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AgentControlEnvResolver } from '../../agent-control/ports.ts';
import type { PiExecutableSnapshot } from '../../pi-runtime';
import type {
	PiSessionBranchRow,
	PiSessionRow,
} from '../../storage/repositories';
import { getMaxOrdinalForBranch } from '../../storage/repositories/pi-event-repository.ts';
import {
	createPiSession,
	getMainBranchForSession,
	getPiSessionById,
	updatePiSession,
} from '../../storage/repositories/pi-session-repository.ts';
import type { SessionNamingInput } from '../naming/session-naming.ts';
import type { PiAgentClient, PiAgentSession } from '../pi-agent-client.ts';
import type { PiAgentSubscription } from '../pi-agent-types.ts';
import { PiSessionServiceError } from '../pi-session-service-error.ts';
import type {
	PiSessionEventSink,
	PiSessionSnapshot,
} from '../pi-session-types.ts';
import type { ActiveSession, ActiveSessionMap } from './active-session.ts';
import { attachSessionToChatTab } from './chat-tab-plumbing.ts';
import { toSnapshot } from './session-snapshot.ts';

/** Lifecycle-side open request, identical shape to the public lifecycle alias. */
interface OpenRequest {
	chatTabId?: string | null;
	executable: PiExecutableSnapshot;
	initialPrompt?: string | null;
	label?: string | null;
	model?: string | null;
	/** Spawning agent's session id when opened via the control layer, else absent. */
	parentSessionId?: string | null;
	resumeSessionId?: string | null;
	thinkingLevel?: string | null;
	workspaceCwd: string;
	workspaceId: string;
}

/** Dependencies for {@link createSessionOpener}. */
interface SessionOpenerOptions {
	activeSessions: ActiveSessionMap;
	eventSink: PiSessionEventSink | undefined;
	now: () => Date;
	piAgentClient: PiAgentClient;
	/** Fires the unified title + branch naming attempt for a freshly opened session. */
	queueNaming: (input: SessionNamingInput) => void;
	/**
	 * Resolves the agent-control environment (control-server URL + per-session
	 * token) injected into the Pi child so its shipped extension can call back
	 * into the app. Absent in tests and when the control layer is disabled.
	 */
	resolveAgentControlEnv?: AgentControlEnvResolver;
	subscribeToRuntime: (input: {
		branchId: string;
		database: DatabaseSync;
		runtimeSession: PiAgentSession;
		sessionId: string;
	}) => PiAgentSubscription;
}

/** Public surface of the session opener: opens or resumes a session and returns its snapshot. */
interface SessionOpener {
	openSession: (input: {
		database: DatabaseSync;
		request: OpenRequest;
	}) => Promise<PiSessionSnapshot>;
}

/**
 * Owns the open/resume flow: row creation, runtime session attachment, active
 * map insertion, and snapshot projection. Stays free of summary-queue and
 * runtime-event handler internals — those are wired by the lifecycle via the
 * `subscribeToRuntime` callback.
 */
export function createSessionOpener({
	activeSessions,
	eventSink,
	now,
	piAgentClient,
	queueNaming,
	resolveAgentControlEnv,
	subscribeToRuntime,
}: SessionOpenerOptions): SessionOpener {
	const resumePersistedSession = async ({
		database,
		request,
	}: {
		database: DatabaseSync;
		request: OpenRequest;
	}): Promise<PiSessionSnapshot> => {
		if (!request.resumeSessionId) {
			throw new PiSessionServiceError({
				code: 'session-not-open',
				message: 'A persisted session id is required to resume a Pi session.',
			});
		}

		const row = getPiSessionById({
			database,
			id: request.resumeSessionId,
		});
		if (!row || row.workspaceId !== request.workspaceId) {
			throw new PiSessionServiceError({
				code: 'session-not-open',
				message: `Pi session ${request.resumeSessionId} cannot be resumed in this workspace.`,
			});
		}

		const mainBranch = getMainBranchForSession({
			database,
			piSessionId: row.id,
		});
		if (!mainBranch) {
			throw new PiSessionServiceError({
				code: 'session-not-open',
				message: `Pi session ${row.id} has no branch to resume.`,
			});
		}

		const attachedTab = attachSessionToChatTab({
			chatTabId: request.chatTabId ?? null,
			database,
			label: request.label ?? row.label ?? undefined,
			sessionId: row.id,
			workspaceId: row.workspaceId,
		});

		const alreadyActive = activeSessions.get(row.id);
		if (alreadyActive) {
			activeSessions.set(row.id, {
				...alreadyActive,
				chatTabId: attachedTab.id,
			});
			return toSnapshot({
				branchId: alreadyActive.branch.id,
				database,
				row: alreadyActive.row,
				runtimeOpen: true,
			});
		}

		const nativePiSessionId = row.piSessionId ?? randomUUID();
		const startingRow =
			updatePiSession({
				database,
				id: row.id,
				patch: {
					closedAt: null,
					lastError: null,
					model: request.model ?? row.model,
					piSessionId: nativePiSessionId,
					status: 'starting',
					thinkingLevel: request.thinkingLevel ?? row.thinkingLevel,
				},
			}) ?? row;

		const runtimeSession = await createRuntimeSessionOrFail({
			database,
			modelOverride: request.model ?? row.model,
			now,
			piAgentClient,
			rowForErrorPatch: row,
			sessionInput: {
				env: resolveAgentControlEnv?.({
					workspaceId: request.workspaceId,
					sessionId: row.id,
					parentSessionId: request.parentSessionId ?? null,
				}),
				executable: request.executable,
				label: request.label ?? row.label ?? undefined,
				piSessionId: nativePiSessionId,
				workspaceCwd: row.cwd || request.workspaceCwd,
			},
			thinkingLevel: request.thinkingLevel ?? row.thinkingLevel,
		});

		const subscription = subscribeToRuntime({
			branchId: mainBranch.id,
			database,
			runtimeSession,
			sessionId: row.id,
		});
		insertActiveSession({
			activeSessions,
			branch: mainBranch,
			chatTabId: attachedTab.id,
			database,
			executable: request.executable,
			row: startingRow,
			runtimeSession,
			subscription,
		});

		return toSnapshot({
			branchId: mainBranch.id,
			database,
			row: startingRow,
			runtimeOpen: true,
		});
	};

	const openSession = async ({
		database,
		request,
	}: {
		database: DatabaseSync;
		request: OpenRequest;
	}): Promise<PiSessionSnapshot> => {
		if (request.resumeSessionId) {
			return resumePersistedSession({ database, request });
		}

		const nativePiSessionId = randomUUID();
		const { mainBranch, session } = createPiSession({
			database,
			input: {
				cwd: request.workspaceCwd,
				executableId: request.executable.command ?? null,
				executablePath: request.executable.command ?? null,
				label: request.label ?? null,
				metadata: { nativePiSessionId },
				model: request.model ?? null,
				piSessionId: nativePiSessionId,
				thinkingLevel: request.thinkingLevel ?? null,
				workspaceId: request.workspaceId,
			},
		});

		const attachedTab = attachSessionToChatTab({
			chatTabId: request.chatTabId ?? null,
			database,
			label: request.label ?? undefined,
			sessionId: session.id,
			workspaceId: request.workspaceId,
		});

		const runtimeSession = await createRuntimeSessionOrFail({
			database,
			modelOverride: request.model ?? null,
			now,
			piAgentClient,
			rowForErrorPatch: session,
			sessionInput: {
				env: resolveAgentControlEnv?.({
					workspaceId: request.workspaceId,
					sessionId: session.id,
					parentSessionId: request.parentSessionId ?? null,
				}),
				executable: request.executable,
				label: request.label ?? undefined,
				piSessionId: nativePiSessionId,
				workspaceCwd: request.workspaceCwd,
			},
			thinkingLevel: request.thinkingLevel ?? null,
		});

		const startedRow =
			updatePiSession({
				database,
				id: session.id,
				patch: { status: 'starting' },
			}) ?? session;

		const subscription = subscribeToRuntime({
			branchId: mainBranch.id,
			database,
			runtimeSession,
			sessionId: session.id,
		});
		insertActiveSession({
			activeSessions,
			branch: mainBranch,
			chatTabId: attachedTab.id,
			database,
			executable: request.executable,
			row: startedRow,
			runtimeSession,
			subscription,
		});

		// Single unified naming attempt (title + branch) off the first prompt; it
		// self-gates per field and is retried on each turn-idle if anything failed.
		queueNaming({
			branchId: mainBranch.id,
			chatTabId: attachedTab.id,
			database,
			eventSink,
			executable: request.executable,
			initialPrompt: request.initialPrompt ?? null,
			liveSession: runtimeSession,
			model: startedRow.model,
			sessionId: session.id,
			workspaceCwd: request.workspaceCwd,
			workspaceId: request.workspaceId,
		});

		return toSnapshot({
			branchId: mainBranch.id,
			database,
			row: startedRow,
			runtimeOpen: true,
		});
	};

	return { openSession };
}

/**
 * Calls `piAgentClient.createSession` and patches the persisted row to
 * `errored` if the runtime spawn rejects, then rethrows.
 */
async function createRuntimeSessionOrFail({
	database,
	modelOverride,
	now,
	piAgentClient,
	rowForErrorPatch,
	sessionInput,
	thinkingLevel,
}: {
	database: DatabaseSync;
	modelOverride: string | null;
	now: () => Date;
	piAgentClient: PiAgentClient;
	rowForErrorPatch: PiSessionRow;
	sessionInput: {
		env?: Record<string, string>;
		executable: PiExecutableSnapshot;
		label?: string;
		piSessionId: string;
		workspaceCwd: string;
	};
	thinkingLevel: string | null;
}): Promise<PiAgentSession> {
	try {
		return await piAgentClient.createSession({
			env: sessionInput.env,
			executable: sessionInput.executable,
			label: sessionInput.label,
			modelOverride,
			piSessionId: sessionInput.piSessionId,
			thinkingLevel,
			workspaceCwd: sessionInput.workspaceCwd,
		});
	} catch (cause) {
		updatePiSession({
			database,
			id: rowForErrorPatch.id,
			patch: {
				closedAt: now().toISOString(),
				lastError: cause instanceof Error ? cause.message : String(cause),
				status: 'errored',
			},
		});
		throw cause;
	}
}

/**
 * Registers a freshly opened session in the active-session map, seeding its
 * branch, chat tab, runtime session, and event subscription.
 */
function insertActiveSession({
	activeSessions,
	branch,
	chatTabId,
	database,
	executable,
	row,
	runtimeSession,
	subscription,
}: {
	activeSessions: ActiveSessionMap;
	branch: PiSessionBranchRow;
	chatTabId: string;
	database: DatabaseSync;
	executable: PiExecutableSnapshot;
	row: PiSessionRow;
	runtimeSession: PiAgentSession;
	subscription: PiAgentSubscription;
}): void {
	const active: ActiveSession = {
		activeTurnId: null,
		agentResponsePendingSummary: false,
		branch,
		chatTabId,
		deltaCounter: 0,
		executable,
		lastBroadcastOrdinal: getMaxOrdinalForBranch({
			branchId: branch.id,
			database,
		}),
		piRuntimeSession: runtimeSession,
		row,
		summaryQueued: false,
		summaryWriteInFlight: false,
		subscription,
	};
	activeSessions.set(row.id, active);
}
