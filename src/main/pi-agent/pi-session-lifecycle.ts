import type { DatabaseSync } from 'node:sqlite';

import type { PiExecutableSnapshot } from '../pi-runtime/pi-executable.ts';
import {
	bindPiSession,
	type ChatTabRow,
	closeChatTab,
	listOpenChatTabs,
	listOpenChatTabsBySession,
	openChatTab,
} from '../storage/repositories/chat-tab-repository.ts';
import type { PiEventRow } from '../storage/repositories/pi-event-repository.ts';
import {
	createPiSession,
	createTurn,
	type PiSessionBranchRow,
	type PiSessionRow,
	updatePiSession,
	updateTurn,
} from '../storage/repositories/pi-session-repository.ts';
import type { PiAgentClient, PiAgentSession } from './pi-agent-client.ts';
import type { PiAgentEvent, PiAgentSubscription } from './pi-agent-types.ts';
import { PiSessionServiceError } from './pi-session-service-error.ts';
import type {
	PiSessionEventSink,
	PiSessionSnapshot,
} from './pi-session-types.ts';

/** Live binding between a persisted Pi session row and a runtime PiAgentSession. */
interface ActiveSession {
	activeTurnId: string | null;
	branch: PiSessionBranchRow;
	piRuntimeSession: PiAgentSession;
	row: PiSessionRow;
	subscription: PiAgentSubscription;
}

export interface OpenPiSessionRequest {
	chatTabId?: string | null;
	executable: PiExecutableSnapshot;
	initialPrompt?: string | null;
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

/**
 * Persistence port — lifecycle calls this to mirror runtime events into
 * `pi_session_events`. Returns the persisted row, or `null` if persistence
 * failed.
 */
export type PersistRuntimeEventPort = (input: {
	branchId: string;
	database: DatabaseSync;
	event: PiAgentEvent;
	sessionId: string;
	turnId: string | null;
}) => PiEventRow | null;

/** Chat-title port — lifecycle fires this once per new session to queue title gen. */
export type QueueChatTitlePort = (input: {
	branchId: string;
	chatTitleTimeoutMs: number;
	database: DatabaseSync;
	eventSink: PiSessionEventSink | undefined;
	executable: PiExecutableSnapshot;
	initialPrompt: string | null;
	piAgentClient: PiAgentClient;
	sessionId: string;
	tabId: string;
	workspaceCwd: string;
	workspaceId: string;
}) => void;

export interface PiSessionLifecycleOptions {
	chatTitleTimeoutMs: number;
	eventSink: PiSessionEventSink | undefined;
	now: () => Date;
	persistRuntimeEvent: PersistRuntimeEventPort;
	piAgentClient: PiAgentClient;
	queueChatTitle: QueueChatTitlePort;
	requireDatabase: () => DatabaseSync;
}

export interface PiSessionLifecycle {
	getActiveSession: (sessionId: string) => ActiveSessionView | null;
	openSession: (request: OpenPiSessionRequest) => Promise<PiSessionSnapshot>;
	shutdownActiveSessions: () => Promise<void>;
	stopSession: (request: StopPiSessionRequest) => Promise<void>;
	submitPrompt: (
		request: SubmitPiPromptRequest,
	) => Promise<SubmitPiPromptResult>;
}

/** Read-only view of an active session for the composition root. */
export interface ActiveSessionView {
	branch: PiSessionBranchRow;
	row: PiSessionRow;
}

/**
 * Owns the active-session map and the open/submit/stop/runtime-event state
 * machine. Persistence and chat-title generation are injected as ports so
 * this module stays free of their concrete dependencies.
 */
export function createPiSessionLifecycle({
	chatTitleTimeoutMs,
	eventSink,
	now,
	persistRuntimeEvent,
	piAgentClient,
	queueChatTitle,
	requireDatabase,
}: PiSessionLifecycleOptions): PiSessionLifecycle {
	const activeSessions = new Map<string, ActiveSession>();

	const openSession: PiSessionLifecycle['openSession'] = async (request) => {
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

		const attachedTab = attachSessionToChatTab({
			chatTabId: request.chatTabId ?? null,
			database,
			label: request.label,
			sessionId: session.id,
			workspaceId: request.workspaceId,
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

		queueChatTitle({
			branchId: mainBranch.id,
			chatTitleTimeoutMs,
			database,
			eventSink,
			executable: request.executable,
			initialPrompt: request.initialPrompt ?? null,
			piAgentClient,
			sessionId: session.id,
			tabId: attachedTab.id,
			workspaceCwd: request.workspaceCwd,
			workspaceId: request.workspaceId,
		});

		return toSnapshot({ branchId: mainBranch.id, database, row: startedRow });
	};

	const submitPrompt: PiSessionLifecycle['submitPrompt'] = async (request) => {
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
		activeSessions.set(request.sessionId, {
			...active,
			activeTurnId: turn.id,
		});
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

	const stopSession: PiSessionLifecycle['stopSession'] = async (request) => {
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
		const persistedRow = persistRuntimeEvent({
			branchId,
			database,
			event,
			sessionId,
			turnId: active?.activeTurnId ?? null,
		});

		if (persistedRow && eventSink && active) {
			try {
				eventSink({
					event: persistedRow,
					sessionId,
					workspaceId: active.row.workspaceId,
				});
			} catch {
				// Sink failures (renderer gone, IPC closed) must not break persistence.
			}
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
		getActiveSession: (sessionId) => {
			const active = activeSessions.get(sessionId);
			if (!active) {
				return null;
			}
			return { branch: active.branch, row: active.row };
		},
		openSession,
		shutdownActiveSessions: async () => {
			const open = [...activeSessions.values()];
			activeSessions.clear();
			for (const session of open) {
				session.subscription.unsubscribe();
				await session.piRuntimeSession.close().catch(() => undefined);
			}
		},
		stopSession,
		submitPrompt,
	};
}

/** Snapshot projection used by both the lifecycle and the composition root. */
export function toSnapshot({
	branchId,
	database,
	row,
}: {
	branchId: string;
	database: DatabaseSync;
	row: PiSessionRow;
}): PiSessionSnapshot {
	return {
		branchId,
		closedAt: row.closedAt,
		createdAt: row.createdAt,
		cwd: row.cwd,
		id: row.id,
		label: row.label,
		model: row.model,
		openedTabs: listOpenChatTabs({ database, workspaceId: row.workspaceId }),
		piSessionId: row.piSessionId,
		status: row.status,
		thinkingLevel: row.thinkingLevel,
		updatedAt: row.updatedAt,
		workspaceId: row.workspaceId,
	};
}

/** Binds a new Pi session to an existing chat tab, or creates a tab fallback. */
function attachSessionToChatTab({
	chatTabId,
	database,
	label,
	sessionId,
	workspaceId,
}: {
	chatTabId: string | null;
	database: DatabaseSync;
	label?: string;
	sessionId: string;
	workspaceId: string;
}): ChatTabRow {
	if (chatTabId) {
		const tab = bindPiSession({
			database,
			id: chatTabId,
			piSessionId: sessionId,
		});
		if (tab) {
			return tab;
		}
	}

	return openChatTab({
		database,
		input: {
			kind: 'chat',
			piSessionId: sessionId,
			title: label?.trim() || 'Chat',
			workspaceId,
		},
	});
}

function closeOpenChatTabs({
	database,
	sessionId,
}: {
	database: DatabaseSync;
	sessionId: string;
}): void {
	const tabs = listOpenChatTabsBySession({ database, sessionId });
	for (const tab of tabs) {
		closeChatTab({ database, id: tab.id });
	}
}
