import type { DatabaseSync } from 'node:sqlite';
import type { PiExecutableSnapshot } from '../pi/pi-executable.ts';
import type { EnsembleDatabaseService } from '../storage/database.ts';
import {
	type ChatTabRow,
	closeChatTab,
	listOpenChatTabs,
	openChatTab,
} from '../storage/repositories/chat-tab-repository.ts';
import {
	type AppendPiEventInput,
	appendPiEvent,
	listEventsByBranch,
	type PiEventRow,
} from '../storage/repositories/pi-event-repository.ts';
import {
	createPiSession,
	createTurn,
	getPiSessionBranchById,
	listPiSessionBranches,
	listPiSessionsByWorkspace,
	type PiSessionBranchRow,
	type PiSessionRow,
	type PiTurnRow,
	updatePiSession,
	updateTurn,
} from '../storage/repositories/pi-session-repository.ts';
import type { PiAgentClient, PiAgentSession } from './pi-agent-client.ts';
import type {
	PiAgentEvent,
	PiAgentSessionMetadata,
	PiAgentSubscription,
} from './pi-agent-types.ts';

/** Live binding between a persisted Pi session row and a runtime PiAgentSession. */
interface ActiveSession {
	activeTurnId: string | null;
	branch: PiSessionBranchRow;
	piRuntimeSession: PiAgentSession;
	row: PiSessionRow;
	subscription: PiAgentSubscription;
}

export interface PiSessionSnapshot {
	branchId: string;
	model: string | null;
	openedTabs: readonly ChatTabRow[];
	row: PiSessionRow;
	thinkingLevel: string | null;
}

export interface OpenPiSessionRequest {
	executable: PiExecutableSnapshot;
	label?: string;
	model?: string | null;
	thinkingLevel?: string | null;
	workspaceCwd: string;
	workspaceId: string;
}

export interface SubmitPiPromptRequest {
	model?: string | null;
	prompt: string;
	sessionId: string;
	thinkingLevel?: string | null;
}

export interface SubmitPiPromptResult {
	acceptedAt: string;
	turnId: string;
}

export interface StopPiSessionRequest {
	reason?: string;
	sessionId: string;
}

export interface PiSessionServiceOptions {
	databaseService: EnsembleDatabaseService;
	piAgentClient: PiAgentClient;
	now?: () => Date;
}

/** Public surface of the Pi session service used by IPC handlers. */
export interface PiSessionService {
	getSession: (sessionId: string) => PiSessionSnapshot | null;
	listSessionsForWorkspace: (
		workspaceId: string,
	) => readonly PiSessionSnapshot[];
	listEvents: (branchId: string) => readonly PiEventRow[];
	openSession: (request: OpenPiSessionRequest) => Promise<PiSessionSnapshot>;
	shutdown: () => Promise<void>;
	stopSession: (request: StopPiSessionRequest) => Promise<void>;
	submitPrompt: (
		request: SubmitPiPromptRequest,
	) => Promise<SubmitPiPromptResult>;
}

/**
 * Coordinates Pi runtime sessions with their SQLite persistence: opens a
 * session in the PiAgentClient, creates the matching `pi_sessions` row, and
 * mirrors every `PiAgentEvent` into `pi_session_events` for later rehydration.
 */
export function createPiSessionService({
	databaseService,
	piAgentClient,
	now = () => new Date(),
}: PiSessionServiceOptions): PiSessionService {
	const activeSessions = new Map<string, ActiveSession>();

	const requireDatabase = (): DatabaseSync => {
		const connection = databaseService.getConnection();
		if (!connection) {
			throw new PiSessionServiceError({
				code: 'database-unavailable',
				message: 'Database is not open; cannot manage Pi sessions.',
			});
		}
		return connection.database;
	};

	const toSnapshot = (
		row: PiSessionRow,
		branchId: string,
	): PiSessionSnapshot => {
		const database = requireDatabase();
		return {
			branchId,
			model: row.model,
			openedTabs: listOpenChatTabs({ database, workspaceId: row.workspaceId }),
			row,
			thinkingLevel: row.thinkingLevel,
		};
	};

	const openSession: PiSessionService['openSession'] = async (request) => {
		const database = requireDatabase();
		const { mainBranch, session } = createPiSession({
			database,
			input: {
				cwd: request.workspaceCwd,
				executableId: request.executable.command ?? null,
				executablePath: request.executable.command ?? null,
				label: request.label ?? null,
				model: request.model ?? null,
				thinkingLevel: request.thinkingLevel ?? null,
				workspaceId: request.workspaceId,
			},
		});

		openChatTab({
			database,
			input: {
				kind: 'chat',
				piSessionId: session.id,
				title: request.label?.trim() || 'Chat',
				workspaceId: request.workspaceId,
			},
		});

		let runtimeSession: PiAgentSession;
		try {
			runtimeSession = await piAgentClient.createSession({
				executable: request.executable,
				label: request.label,
				modelOverride: request.model ?? null,
				workspaceCwd: request.workspaceCwd,
			});
		} catch (cause) {
			updatePiSession({
				database,
				id: session.id,
				patch: {
					closedAt: now().toISOString(),
					lastError: cause instanceof Error ? cause.message : String(cause),
					status: 'errored',
				},
			});
			throw cause;
		}

		const startedRow =
			updatePiSession({
				database,
				id: session.id,
				patch: { status: 'starting' },
			}) ?? session;

		const subscription = runtimeSession.subscribe((event) => {
			handleRuntimeEvent({
				branchId: mainBranch.id,
				database,
				event,
				sessionId: session.id,
			});
		});

		const active: ActiveSession = {
			activeTurnId: null,
			branch: mainBranch,
			piRuntimeSession: runtimeSession,
			row: startedRow,
			subscription,
		};
		activeSessions.set(session.id, active);

		return toSnapshot(startedRow, mainBranch.id);
	};

	const submitPrompt: PiSessionService['submitPrompt'] = async (request) => {
		const database = requireDatabase();
		const active = activeSessions.get(request.sessionId);
		if (!active) {
			throw new PiSessionServiceError({
				code: 'session-not-open',
				message: `Pi session ${request.sessionId} is not open.`,
			});
		}

		const turn = createTurn({
			database,
			input: {
				branchId: active.branch.id,
				model: request.model ?? null,
				promptText: request.prompt,
				thinkingLevel: request.thinkingLevel ?? null,
			},
		});
		active.activeTurnId = turn.id;
		updatePiSession({
			database,
			id: request.sessionId,
			patch: {
				model: request.model ?? active.row.model,
				status: 'streaming',
				thinkingLevel: request.thinkingLevel ?? active.row.thinkingLevel,
			},
		});

		const acknowledgement = await active.piRuntimeSession.submit({
			modelOverride: request.model ?? undefined,
			prompt: request.prompt,
		});
		return acknowledgement;
	};

	const stopSession: PiSessionService['stopSession'] = async (request) => {
		const database = requireDatabase();
		const active = activeSessions.get(request.sessionId);
		if (!active) {
			return;
		}
		await active.piRuntimeSession.abort(request.reason);
		if (active.activeTurnId) {
			updateTurn({
				database,
				id: active.activeTurnId,
				patch: {
					completedAt: now().toISOString(),
					status: 'aborted',
				},
			});
		}
		updatePiSession({
			database,
			id: request.sessionId,
			patch: { status: 'closed', closedAt: now().toISOString() },
		});
		closeOpenChatTabs({ database, sessionId: request.sessionId });
		activeSessions.delete(request.sessionId);
	};

	const handleRuntimeEvent = ({
		branchId,
		database,
		event,
		sessionId,
	}: {
		branchId: string;
		database: DatabaseSync;
		event: PiAgentEvent;
		sessionId: string;
	}): void => {
		const active = activeSessions.get(sessionId);
		// The runtime's turnId (event.turnId) is an opaque adapter identifier and
		// is NOT a foreign key into pi_turns. We attach the active turn row's id
		// (created via createTurn) so callers can group events per turn; the raw
		// runtime turn id is preserved inside the payload.
		const input: AppendPiEventInput = {
			branchId,
			eventType: event.type,
			payload: eventPayload(event),
			stream:
				event.type === 'error' && event.error.message === 'Pi RPC stderr'
					? 'stderr'
					: 'protocol',
			turnId: active?.activeTurnId ?? null,
		};
		try {
			appendPiEvent({ database, input });
		} catch {
			// Persistence is best-effort on the live path; the timeline rehydrates
			// from whatever events did land.
		}

		if (event.type === 'metadata' && event.metadata.sessionId) {
			updatePiSession({
				database,
				id: sessionId,
				patch: { piSessionId: event.metadata.sessionId },
			});
		}
		if (event.type === 'status') {
			updatePiSession({
				database,
				id: sessionId,
				patch: { status: event.status },
			});
		}
		if (event.type === 'shutdown') {
			updatePiSession({
				database,
				id: sessionId,
				patch: { closedAt: now().toISOString(), status: 'closed' },
			});
			if (active?.activeTurnId) {
				updateTurn({
					database,
					id: active.activeTurnId,
					patch: {
						completedAt: now().toISOString(),
						status: event.reason === 'completed' ? 'completed' : 'aborted',
					},
				});
			}
			activeSessions.delete(sessionId);
		}
	};

	return {
		getSession: (sessionId) => {
			const database = requireDatabase();
			const active = activeSessions.get(sessionId);
			if (active) {
				return toSnapshot(active.row, active.branch.id);
			}
			const sessions = listPiSessionsByWorkspace({
				database,
				workspaceId: '',
			});
			const row = sessions.find((s) => s.id === sessionId);
			if (!row) {
				return null;
			}
			const branches = listPiSessionBranches({
				database,
				piSessionId: row.id,
			});
			const mainBranch = branches.find((b) => b.kind === 'main') ?? branches[0];
			if (!mainBranch) {
				return null;
			}
			return toSnapshot(row, mainBranch.id);
		},
		listEvents: (branchId) => {
			const database = requireDatabase();
			return listEventsByBranch({ branchId, database });
		},
		listSessionsForWorkspace: (workspaceId) => {
			const database = requireDatabase();
			const rows = listPiSessionsByWorkspace({ database, workspaceId });
			return rows
				.map((row) => {
					const branches = listPiSessionBranches({
						database,
						piSessionId: row.id,
					});
					const mainBranch =
						branches.find((b) => b.kind === 'main') ?? branches[0];
					if (!mainBranch) {
						return null;
					}
					return toSnapshot(row, mainBranch.id);
				})
				.filter((snapshot): snapshot is PiSessionSnapshot => snapshot !== null);
		},
		openSession,
		shutdown: async () => {
			const open = [...activeSessions.values()];
			activeSessions.clear();
			for (const session of open) {
				session.subscription.unsubscribe();
				await session.piRuntimeSession.close().catch(() => undefined);
			}
			await piAgentClient.shutdown();
		},
		stopSession,
		submitPrompt,
	};
}

function closeOpenChatTabs({
	database,
	sessionId,
}: {
	database: DatabaseSync;
	sessionId: string;
}): void {
	const tabs = database
		.prepare(
			`SELECT id, workspace_id FROM chat_tabs WHERE pi_session_id = ? AND closed_at IS NULL`,
		)
		.all(sessionId) as unknown as Array<{ id: string }>;
	for (const tab of tabs) {
		closeChatTab({ database, id: tab.id });
	}
}

function eventPayload(event: PiAgentEvent): unknown {
	switch (event.type) {
		case 'error':
			return { error: event.error };
		case 'message':
			return { payload: event.payload, role: event.role };
		case 'metadata':
			return { metadata: event.metadata };
		case 'shutdown':
			return { reason: event.reason };
		case 'status':
			return { previous: event.previous, status: event.status };
		default:
			return event;
	}
}

/** Typed error raised by the Pi session service for IPC translation. */
export class PiSessionServiceError extends Error {
	readonly code: PiSessionServiceErrorCode;

	constructor(input: { code: PiSessionServiceErrorCode; message: string }) {
		super(input.message);
		this.name = 'PiSessionServiceError';
		this.code = input.code;
	}
}

export type PiSessionServiceErrorCode =
	| 'database-unavailable'
	| 'session-not-open';

export type { PiSessionBranchRow, PiSessionRow, PiTurnRow };
