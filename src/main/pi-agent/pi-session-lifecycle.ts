import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { PiSessionEventWire } from '../../shared/ipc/contracts/pi-session.ts';
import type { PiExecutableSnapshot } from '../pi-runtime/pi-executable.ts';
import {
	bindPiSession,
	type ChatTabRow,
	closeChatTab,
	getChatTabById,
	listOpenChatTabs,
	listOpenChatTabsBySession,
	openChatTab,
	setChatTabMetadata,
} from '../storage/repositories/chat-tab-repository.ts';
import {
	listEventsByBranch,
	type PiEventRow,
} from '../storage/repositories/pi-event-repository.ts';
import {
	createPiSession,
	createTurn,
	getMainBranchForSession,
	getPiSessionById,
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
import type {
	SessionSummaryWriter,
	WriteSessionSummaryResult,
} from './session-summary-writer.ts';

/** Live binding between a persisted Pi session row and a runtime PiAgentSession. */
interface ActiveSession {
	activeTurnId: string | null;
	agentResponsePendingSummary: boolean;
	branch: PiSessionBranchRow;
	chatTabId: string;
	piRuntimeSession: PiAgentSession;
	row: PiSessionRow;
	summaryQueued: boolean;
	summaryWriteInFlight: boolean;
	subscription: PiAgentSubscription;
}

export interface OpenPiSessionRequest {
	chatTabId?: string | null;
	executable: PiExecutableSnapshot;
	initialPrompt?: string | null;
	label?: string;
	model?: string | null;
	resumeSessionId?: string | null;
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
	sessionSummaryWriter?: SessionSummaryWriter;
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
	sessionSummaryWriter,
}: PiSessionLifecycleOptions): PiSessionLifecycle {
	const activeSessions = new Map<string, ActiveSession>();

	/** Reopens a persisted Ensemble session and attaches a Pi RPC child. */
	const resumePersistedSession = async ({
		database,
		request,
	}: {
		database: DatabaseSync;
		request: OpenPiSessionRequest;
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

		let runtimeSession: PiAgentSession;
		try {
			runtimeSession = await piAgentClient.createSession({
				executable: request.executable,
				label: request.label ?? row.label ?? undefined,
				modelOverride: request.model ?? row.model,
				piSessionId: nativePiSessionId,
				workspaceCwd: row.cwd || request.workspaceCwd,
			});
		} catch (cause) {
			updatePiSession({
				database,
				id: row.id,
				patch: {
					closedAt: now().toISOString(),
					lastError: cause instanceof Error ? cause.message : String(cause),
					status: 'errored',
				},
			});
			throw cause;
		}

		const subscription = runtimeSession.subscribe((event) => {
			handleRuntimeEvent({
				branchId: mainBranch.id,
				database,
				event,
				sessionId: row.id,
			});
		});
		activeSessions.set(row.id, {
			activeTurnId: null,
			agentResponsePendingSummary: false,
			branch: mainBranch,
			chatTabId: attachedTab.id,
			piRuntimeSession: runtimeSession,
			row: startingRow,
			summaryQueued: false,
			summaryWriteInFlight: false,
			subscription,
		});

		return toSnapshot({
			branchId: mainBranch.id,
			database,
			row: startingRow,
			runtimeOpen: true,
		});
	};

	const openSession: PiSessionLifecycle['openSession'] = async (request) => {
		const database = requireDatabase();
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
				piSessionId: nativePiSessionId,
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
			agentResponsePendingSummary: false,
			branch: mainBranch,
			chatTabId: attachedTab.id,
			piRuntimeSession: runtimeSession,
			row: startedRow,
			summaryQueued: false,
			summaryWriteInFlight: false,
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

		return toSnapshot({
			branchId: mainBranch.id,
			database,
			row: startedRow,
			runtimeOpen: true,
		});
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
			agentResponsePendingSummary: false,
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

	/** Persists one normalized runtime event and schedules summary refreshes. */
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

		if (active && event.type === 'message' && event.role === 'agent') {
			activeSessions.set(sessionId, {
				...active,
				agentResponsePendingSummary: true,
			});
			queueSummaryAfterAgentResponse({ database, sessionId });
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
			if (event.status === 'idle') {
				queueSummaryAfterAgentResponse({ database, sessionId });
			}
		}
		if (event.type === 'shutdown') {
			updatePiSession({
				database,
				id: sessionId,
				patch: { closedAt: now().toISOString(), status: 'closed' },
			});
			queueSummaryAfterAgentResponse({ database, sessionId });
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

	/** Marks the latest agent turn for summary writing once the runtime is idle. */
	const queueSummaryAfterAgentResponse = ({
		database,
		sessionId,
	}: {
		database: DatabaseSync;
		sessionId: string;
	}): void => {
		const active = activeSessions.get(sessionId);
		if (!active?.agentResponsePendingSummary || !sessionSummaryWriter) {
			return;
		}
		const queued: ActiveSession = {
			...active,
			agentResponsePendingSummary: false,
			summaryQueued: true,
		};
		activeSessions.set(sessionId, queued);
		if (!active.summaryWriteInFlight) {
			void drainSummaryQueue({ database, sessionId });
		}
	};

	/** Serializes live summary writes so older LLM responses cannot win races. */
	const drainSummaryQueue = async ({
		database,
		sessionId,
	}: {
		database: DatabaseSync;
		sessionId: string;
	}): Promise<void> => {
		for (;;) {
			const active = activeSessions.get(sessionId);
			if (!active?.summaryQueued || !sessionSummaryWriter) {
				return;
			}
			activeSessions.set(sessionId, {
				...active,
				summaryQueued: false,
				summaryWriteInFlight: true,
			});
			try {
				await writeSummaryForSession({ active, database });
			} catch (cause) {
				console.warn('[pi-session-lifecycle] writeSessionSummary failed.', {
					cause: cause instanceof Error ? cause.message : String(cause),
					sessionId,
				});
			}
			const latest = activeSessions.get(sessionId);
			if (!latest) {
				return;
			}
			if (!latest.summaryQueued) {
				activeSessions.set(sessionId, {
					...latest,
					summaryWriteInFlight: false,
				});
				return;
			}
		}
	};

	/** Writes the current persisted transcript to the tab's summary markdown. */
	const writeSummaryForSession = async ({
		active,
		database,
	}: {
		active: ActiveSession;
		database: DatabaseSync;
	}): Promise<void> => {
		if (!sessionSummaryWriter) {
			return;
		}
		const row = getPiSessionById({ database, id: active.row.id });
		if (!row) {
			return;
		}
		const events = listEventsByBranch({
			branchId: active.branch.id,
			database,
		}).map(toEventWire);
		const result = await sessionSummaryWriter.writeSessionSummary({
			branchId: active.branch.id,
			chatTabId: active.chatTabId,
			closedAt: row.closedAt ?? now().toISOString(),
			events,
			piSessionId: row.piSessionId,
			workspaceCwd: row.cwd,
		});
		persistSummaryMetadata({
			database,
			result,
			tabId: active.chatTabId,
		});
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

/** Converts a persisted event row into the renderer/session-summary wire shape. */
function toEventWire(row: PiEventRow): PiSessionEventWire {
	return {
		branchId: row.branchId,
		createdAt: row.createdAt,
		eventType: row.eventType,
		id: row.id,
		ordinal: row.ordinal,
		payload: row.payload,
		stream: row.stream,
		turnId: row.turnId,
	};
}

/** Stores summary file metadata on the owning chat tab for later history views. */
function persistSummaryMetadata({
	database,
	result,
	tabId,
}: {
	database: DatabaseSync;
	result: WriteSessionSummaryResult;
	tabId: string;
}): void {
	const tab = getChatTabById({ database, id: tabId });
	if (!tab) {
		return;
	}
	const nextMetadata = {
		...tab.metadata,
		summary: {
			path: result.path,
			title: result.title,
			usedLlm: result.usedLlm,
		},
	};
	setChatTabMetadata({ database, id: tabId, metadata: nextMetadata });
}

/**
 * Snapshot projection used by both the lifecycle and the composition root.
 *
 * `openedTabs` may be pre-fetched by the caller to amortize the workspace-tabs
 * query across a multi-snapshot listing (avoids an N+1 in
 * `listSessionsForWorkspace`). When omitted, the tabs are fetched from the
 * database for the snapshot's workspace.
 */
export function toSnapshot({
	branchId,
	database,
	openedTabs,
	row,
	runtimeOpen = false,
}: {
	branchId: string;
	database: DatabaseSync;
	openedTabs?: readonly ChatTabRow[];
	row: PiSessionRow;
	runtimeOpen?: boolean;
}): PiSessionSnapshot {
	return {
		branchId,
		closedAt: row.closedAt,
		createdAt: row.createdAt,
		cwd: row.cwd,
		id: row.id,
		label: row.label,
		model: row.model,
		openedTabs:
			openedTabs ??
			listOpenChatTabs({ database, workspaceId: row.workspaceId }),
		piSessionId: row.piSessionId,
		runtimeOpen,
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
