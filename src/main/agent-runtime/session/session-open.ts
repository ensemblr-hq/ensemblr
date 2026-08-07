import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
	type AgentProviderId,
	DEFAULT_AGENT_PROVIDER,
} from '../../../shared/agent-provider.ts';
import type { PermissionMode } from '../../../shared/permissions.ts';
import type { AgentControlEnvResolver } from '../../agent-control/ports.ts';
import type { PiExecutableSnapshot } from '../../pi-runtime';
import type {
	AgentSessionBranchRow,
	AgentSessionRow,
} from '../../storage/repositories';
import { getMaxOrdinalForBranch } from '../../storage/repositories/agent-event-repository.ts';
import {
	createAgentSession,
	getAgentSessionById,
	getMainBranchForSession,
	updateAgentSession,
} from '../../storage/repositories/agent-session-repository.ts';
import type { AgentClient, AgentSession } from '../agent-client.ts';
import { AgentSessionServiceError } from '../agent-session-service-error.ts';
import type {
	AgentSessionEventSink,
	AgentSessionSnapshot,
} from '../agent-session-types.ts';
import type {
	AgentExecutableSnapshot,
	AgentSubscription,
} from '../agent-types.ts';
import type { SessionNamingInput } from '../naming/session-naming.ts';
import type { ActiveSession, ActiveSessionMap } from './active-session.ts';
import {
	type AgentControlWiring,
	resolveAgentControlWiring,
	type SessionBriefNudgeResolver,
} from './agent-control-wiring.ts';
import { attachSessionToChatTab } from './chat-tab-plumbing.ts';
import { assertProviderPin } from './provider-pin.ts';
import { toSnapshot } from './session-snapshot.ts';

/**
 * Resolves the binary a given runtime should launch, overriding the Pi
 * snapshot that rides every open request. `null` leaves the runtime on whatever
 * it resolves for itself; a snapshot whose status is `error` says positively
 * that nothing runnable was found, and fails the open.
 */
export type ProviderExecutablePort = (
	provider: AgentProviderId,
) => Promise<AgentExecutableSnapshot | null>;

/** Lifecycle-side open request, identical shape to the public lifecycle alias. */
interface OpenRequest {
	chatTabId?: string | null;
	executable: PiExecutableSnapshot;
	initialPrompt?: string | null;
	label?: string | null;
	model?: string | null;
	/** Spawning agent's session id when opened via the control layer, else absent. */
	parentSessionId?: string | null;
	/**
	 * Whether the chat's Plan Mode toggle is on. Absent means the caller states no
	 * opinion, and the plan-mode registry decides for a session it already knows.
	 */
	planMode?: boolean;
	/**
	 * Agent runtime the requested model needs. Pins a new session; on a resume
	 * the row already decided, so this is checked against it and a mismatch is
	 * rejected rather than coerced. Absent states no opinion.
	 */
	provider?: AgentProviderId;
	resumeSessionId?: string | null;
	thinkingLevel?: string | null;
	workspaceCwd: string;
	workspaceId: string;
}

/** Dependencies for {@link createSessionOpener}. */
interface SessionOpenerOptions {
	activeSessions: ActiveSessionMap;
	eventSink: AgentSessionEventSink | undefined;
	/**
	 * Reads whether a session is already in Plan Mode, for a resume whose caller
	 * states no opinion. Backed by the in-memory plan-mode registry, so it only
	 * ever answers for a session id that already exists.
	 */
	isPlanModeActive: (agentSessionId: string) => boolean;
	now: () => Date;
	agentClient: AgentClient;
	/** Fires the derived-title attempt for a freshly opened session. */
	queueNaming: (input: SessionNamingInput) => void;
	/**
	 * Resolves the agent-control environment (control-server URL + per-session
	 * token) injected into the agent child so it can call back into the app.
	 * Absent in tests and when the control layer is disabled.
	 */
	resolveAgentControlEnv?: AgentControlEnvResolver;
	/**
	 * Renders the per-turn upkeep block for a session, for runtimes whose system
	 * prompt is fixed at open and that therefore need it prepended per turn.
	 * Absent in tests and when the control layer is disabled.
	 */
	resolveSessionBriefNudge?: SessionBriefNudgeResolver;
	/**
	 * Reads the workspace's permission mode. Called per open rather than captured
	 * once, so a mode the user changes between sessions reaches the next one.
	 */
	resolvePermissionMode: () => PermissionMode;
	/**
	 * Resolves the binary a non-Pi runtime should launch. Omitted, every runtime
	 * but Pi opens on whatever binary it ships with.
	 */
	resolveProviderExecutable?: ProviderExecutablePort;
	subscribeToRuntime: (input: {
		branchId: string;
		database: DatabaseSync;
		runtimeSession: AgentSession;
		sessionId: string;
	}) => AgentSubscription;
}

/** Public surface of the session opener: opens or resumes a session and returns its snapshot. */
interface SessionOpener {
	openSession: (input: {
		database: DatabaseSync;
		request: OpenRequest;
	}) => Promise<AgentSessionSnapshot>;
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
	isPlanModeActive,
	now,
	agentClient,
	queueNaming,
	resolveAgentControlEnv,
	resolvePermissionMode,
	resolveProviderExecutable,
	resolveSessionBriefNudge,
	subscribeToRuntime,
}: SessionOpenerOptions): SessionOpener {
	/**
	 * Reopens a session that already exists, against the row that recorded it.
	 * Everything an open decides, a resume inherits: the row fixes the provider
	 * and cwd, its runtime-session id decides whether the runtime reloads history
	 * or starts fresh, and a requested provider is checked against the pin rather
	 * than coerced. A session already in the active map is only re-pointed at the
	 * requesting chat tab, never opened a second time.
	 * @param input - The workspace database and an open request naming `resumeSessionId`.
	 * @returns Snapshot of the resumed session.
	 */
	const resumePersistedSession = async ({
		database,
		request,
	}: {
		database: DatabaseSync;
		request: OpenRequest;
	}): Promise<AgentSessionSnapshot> => {
		if (!request.resumeSessionId) {
			throw new AgentSessionServiceError({
				code: 'session-not-open',
				message:
					'A persisted session id is required to resume an agent session.',
			});
		}

		const row = getAgentSessionById({
			database,
			id: request.resumeSessionId,
		});
		if (!row || row.workspaceId !== request.workspaceId) {
			throw new AgentSessionServiceError({
				code: 'session-not-open',
				message: `Agent session ${request.resumeSessionId} cannot be resumed in this workspace.`,
			});
		}
		assertProviderPin({ pinned: row.provider, requested: request.provider });

		const mainBranch = getMainBranchForSession({
			database,
			agentSessionId: row.id,
		});
		if (!mainBranch) {
			throw new AgentSessionServiceError({
				code: 'session-not-open',
				message: `Agent session ${row.id} has no branch to resume.`,
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

		const { resumeRuntimeSession, runtimeSessionId } =
			resolveRuntimeContinuity(row);
		const startingRow =
			updateAgentSession({
				database,
				id: row.id,
				patch: {
					closedAt: null,
					lastError: null,
					model: request.model ?? row.model,
					runtimeSessionId,
					status: 'starting',
					thinkingLevel: request.thinkingLevel ?? row.thinkingLevel,
				},
			}) ?? row;

		const runtimeSession = await createRuntimeSessionOrFail({
			control: resolveAgentControlWiring({
				parentSessionId: request.parentSessionId ?? null,
				provider: row.provider,
				resolveAgentControlEnv,
				resolveSessionBriefNudge,
				sessionId: row.id,
				workspaceId: request.workspaceId,
			}),
			database,
			modelOverride: request.model ?? row.model,
			now,
			agentClient,
			permissionMode: resolvePermissionMode(),
			planMode: request.planMode ?? isPlanModeActive(row.id),
			// A chat is pinned to the provider its session was opened on; a resume
			// never re-decides it.
			provider: row.provider,
			rowForErrorPatch: row,
			sessionInput: {
				agentSessionId: row.id,
				executable: await resolveSessionExecutable({
					provider: row.provider,
					requestExecutable: request.executable,
					resolveProviderExecutable,
				}),
				label: request.label ?? row.label ?? undefined,
				resumeRuntimeSession,
				runtimeSessionId,
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

	/**
	 * Starts a session for a chat: mints the row and its main branch, attaches a
	 * chat tab, opens the runtime, and queues the derived title. This is the one
	 * entrypoint for both halves of the contract — a request naming
	 * `resumeSessionId` reopens that session instead, so callers never choose
	 * between two doors, and only a fresh open ever pins a provider.
	 * @param input - The workspace database and the open request.
	 * @returns Snapshot of the opened or resumed session.
	 */
	const openSession = async ({
		database,
		request,
	}: {
		database: DatabaseSync;
		request: OpenRequest;
	}): Promise<AgentSessionSnapshot> => {
		if (request.resumeSessionId) {
			return resumePersistedSession({ database, request });
		}

		const provider = request.provider ?? DEFAULT_AGENT_PROVIDER;
		const runtimeSessionId = randomUUID();
		const { mainBranch, session } = createAgentSession({
			database,
			input: {
				cwd: request.workspaceCwd,
				executableId: request.executable.command ?? null,
				executablePath: request.executable.command ?? null,
				label: request.label ?? null,
				metadata: { runtimeSessionId },
				model: request.model ?? null,
				provider,
				runtimeSessionId,
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
			control: resolveAgentControlWiring({
				parentSessionId: request.parentSessionId ?? null,
				provider,
				resolveAgentControlEnv,
				resolveSessionBriefNudge,
				sessionId: session.id,
				workspaceId: request.workspaceId,
			}),
			database,
			modelOverride: request.model ?? null,
			now,
			agentClient,
			permissionMode: resolvePermissionMode(),
			planMode: request.planMode ?? isPlanModeActive(session.id),
			provider,
			rowForErrorPatch: session,
			sessionInput: {
				agentSessionId: session.id,
				executable: await resolveSessionExecutable({
					provider,
					requestExecutable: request.executable,
					resolveProviderExecutable,
				}),
				label: request.label ?? undefined,
				resumeRuntimeSession: false,
				runtimeSessionId,
				workspaceCwd: request.workspaceCwd,
			},
			thinkingLevel: request.thinkingLevel ?? null,
		});

		const startedRow =
			updateAgentSession({
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
			row: startedRow,
			runtimeSession,
			subscription,
		});

		// Derive a title off the first prompt so the tab is identifiable before the
		// agent names it; self-gates and is retried on each turn-idle.
		queueNaming({
			branchId: mainBranch.id,
			chatTabId: attachedTab.id,
			database,
			eventSink,
			initialPrompt: request.initialPrompt ?? null,
			liveSession: runtimeSession,
			sessionId: session.id,
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
 * Decides the runtime-session identity a resume opens under.
 *
 * Resuming a persisted row and the runtime holding that conversation are two
 * different facts. A row can exist having never been opened — created by another
 * surface, or left behind by an open whose runtime never started — and it carries
 * no runtime session id when that is the case. Such a row mints one and opens
 * fresh; only a row that already carries an id can ask the runtime to reload the
 * conversation, which is why the caller states the answer instead of letting an
 * adapter read it off the id's presence.
 * @param row - The persisted session row being resumed.
 * @returns The runtime session id to open under, and whether it has history.
 */
function resolveRuntimeContinuity(row: AgentSessionRow): {
	resumeRuntimeSession: boolean;
	runtimeSessionId: string;
} {
	return {
		resumeRuntimeSession: row.runtimeSessionId !== null,
		runtimeSessionId: row.runtimeSessionId ?? randomUUID(),
	};
}

/**
 * Snapshot standing for "this runtime has no binary to launch". Carries the same
 * shape a resolver returns when discovery positively fails, so both routes reach
 * the client's one unrunnable-executable rejection.
 */
const UNRUNNABLE_EXECUTABLE: AgentExecutableSnapshot = {
	command: '',
	status: 'error',
};

/**
 * Picks the binary a session launches. Pi's snapshot rides the open request
 * because the IPC layer already gated the session on it; every other runtime
 * resolves its own, and handing Claude Pi's path would pin the wrong executable
 * and fail the SDK's spawn.
 *
 * `null` means one thing only: no resolver is wired for this runtime, so its
 * adapter keeps whatever binary it would pick. A resolver that fails to name a
 * runnable binary — by returning a `status: 'error'` snapshot or by throwing —
 * resolves to {@link UNRUNNABLE_EXECUTABLE}, so the client rejects the open with
 * an actionable error instead of letting the spawn fail opaquely. Degrading a
 * thrown resolver to `null` would instead leave the Agent SDK on its own bundled
 * per-platform binary, which `forge.config.ts` excludes from the packaged app:
 * the session would open in dev and fail unreadably once shipped.
 * @param input - The session's runtime, the request's Pi snapshot, and the per-provider resolver.
 * @returns The executable to launch, or `null` when no resolver is wired for this runtime.
 */
async function resolveSessionExecutable({
	provider,
	requestExecutable,
	resolveProviderExecutable,
}: {
	provider: AgentProviderId;
	requestExecutable: PiExecutableSnapshot;
	resolveProviderExecutable: ProviderExecutablePort | undefined;
}): Promise<AgentExecutableSnapshot | null> {
	if (provider === DEFAULT_AGENT_PROVIDER) {
		return requestExecutable;
	}
	if (!resolveProviderExecutable) {
		return null;
	}
	try {
		return await resolveProviderExecutable(provider);
	} catch (cause) {
		console.warn(
			'[agent-session] could not resolve the runtime executable; failing the open as unrunnable.',
			{
				cause: cause instanceof Error ? cause.message : String(cause),
				provider,
			},
		);
		return UNRUNNABLE_EXECUTABLE;
	}
}

/**
 * Calls `agentClient.createSession` and patches the persisted row to
 * `errored` if the runtime spawn rejects, then rethrows.
 */
async function createRuntimeSessionOrFail({
	control,
	database,
	modelOverride,
	now,
	agentClient,
	permissionMode,
	planMode,
	provider,
	rowForErrorPatch,
	sessionInput,
	thinkingLevel,
}: {
	control: AgentControlWiring;
	database: DatabaseSync;
	modelOverride: string | null;
	now: () => Date;
	agentClient: AgentClient;
	permissionMode: PermissionMode;
	planMode: boolean;
	provider: AgentProviderId;
	rowForErrorPatch: AgentSessionRow;
	sessionInput: {
		/** `agent_sessions.id`, the row key the renderer addresses this chat by. */
		agentSessionId: string;
		executable: AgentExecutableSnapshot | null;
		label?: string;
		/** Whether the runtime already holds history under `runtimeSessionId`. */
		resumeRuntimeSession: boolean;
		/** The runtime's own id for the same session, handed to its CLI. */
		runtimeSessionId: string;
		workspaceCwd: string;
	};
	thinkingLevel: string | null;
}): Promise<AgentSession> {
	try {
		return await agentClient.createSession({
			agentSessionId: sessionInput.agentSessionId,
			controlMcp: control.controlMcp,
			env: control.env,
			executable: sessionInput.executable,
			label: sessionInput.label,
			modelOverride,
			permissionMode,
			planMode,
			resolveTurnPreamble: control.resolveTurnPreamble,
			resumeRuntimeSession: sessionInput.resumeRuntimeSession,
			runtimeSessionId: sessionInput.runtimeSessionId,
			provider,
			systemPromptAppend: control.systemPromptAppend,
			thinkingLevel,
			workspaceCwd: sessionInput.workspaceCwd,
		});
	} catch (cause) {
		updateAgentSession({
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
	row,
	runtimeSession,
	subscription,
}: {
	activeSessions: ActiveSessionMap;
	branch: AgentSessionBranchRow;
	chatTabId: string;
	database: DatabaseSync;
	row: AgentSessionRow;
	runtimeSession: AgentSession;
	subscription: AgentSubscription;
}): void {
	const active: ActiveSession = {
		activeTurnId: null,
		agentResponsePendingSummary: false,
		branch,
		chatTabId,
		deltaCounter: 0,
		lastBroadcastOrdinal: getMaxOrdinalForBranch({
			branchId: branch.id,
			database,
		}),
		agentRuntimeSession: runtimeSession,
		row,
		summaryQueued: false,
		subscription,
	};
	activeSessions.set(row.id, active);
}
