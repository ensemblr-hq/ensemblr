import type { DatabaseSync } from 'node:sqlite';
import type { OpenPiSessionRequest as OpenPiSessionWireRequest, StopPiSessionRequest as StopPiSessionWireRequest, SubmitPiPromptRequest as SubmitPiPromptWireRequest } from '../../shared/ipc/contracts/pi-session';
import type { CheckpointCapturePort } from '../checkpoints/checkpoint-service.ts';
import type { PiExecutableSnapshot } from '../pi-runtime/pi-executable.ts';
import {
	createTurn,
	type PiSessionBranchRow,
	type PiSessionRow,
	updatePiSession,
	updateTurn,
} from '../storage/repositories/pi-session-repository.ts';
import type { PiAgentClient } from './pi-agent-client.ts';
import { PiSessionServiceError } from './pi-session-service-error.ts';
import type {
	PiSessionEventSink,
	PiSessionSnapshot,
} from './pi-session-types.ts';
import type { ActiveSessionMap } from './session/active-session.ts';
import { closeOpenChatTabs } from './session/chat-tab-plumbing.ts';
import {
	createRuntimeEventHandler,
	type PersistRuntimeEventPort,
} from './session/handle-runtime-event.ts';
import { createSessionOpener } from './session/session-open.ts';
import { createSummaryQueue } from './session/summary-queue.ts';
import type { SessionSummaryWriter } from './session-summary-writer.ts';

export type { PersistRuntimeEventPort } from './session/handle-runtime-event.ts';
export { toSnapshot } from './session/session-snapshot.ts';

/**
 * Lifecycle-side open request. Extends the wire `OpenPiSessionRequest` with the
 * resolved `PiExecutableSnapshot` that the composition root injects from
 * `pi-runtime` before calling into the lifecycle. The wire shape is the public
 * IPC contract; this interface documents the divergence at the type level so a
 * field added on either side surfaces here.
 */
export interface OpenPiSessionRequest extends OpenPiSessionWireRequest {
	executable: PiExecutableSnapshot;
}

/**
 * Lifecycle-side submit request. Currently identical to the wire shape — kept
 * as a separate alias so any future main-process-only field (e.g. cancellation
 * token, trace id) lives in this lifecycle type rather than leaking onto the
 * IPC surface.
 */
export type SubmitPiPromptRequest = SubmitPiPromptWireRequest;

export interface SubmitPiPromptResult {
	acceptedAt: string;
	turnId: string;
}

/**
 * Lifecycle-side stop request. Currently identical to the wire shape — see
 * {@link SubmitPiPromptRequest} for the rationale.
 */
export type StopPiSessionRequest = StopPiSessionWireRequest;

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
	/** Pre-prompt git checkpoint capture (ADR 0012); absent in tests. */
	captureCheckpoint?: CheckpointCapturePort;
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
 * machine. Persistence, runtime-event fan-out, summary queueing, and the
 * open/resume flow are delegated to focused helpers under `./session/`.
 */
export function createPiSessionLifecycle({
	captureCheckpoint,
	chatTitleTimeoutMs,
	eventSink,
	now,
	persistRuntimeEvent,
	piAgentClient,
	queueChatTitle,
	requireDatabase,
	sessionSummaryWriter,
}: PiSessionLifecycleOptions): PiSessionLifecycle {
	const activeSessions: ActiveSessionMap = new Map();

	const summaryQueue = createSummaryQueue({
		activeSessions,
		now,
		sessionSummaryWriter,
	});

	const runtimeEventHandler = createRuntimeEventHandler({
		activeSessions,
		eventSink,
		now,
		persistRuntimeEvent,
		summaryQueue,
	});

	const opener = createSessionOpener({
		activeSessions,
		chatTitleTimeoutMs,
		eventSink,
		now,
		piAgentClient,
		queueChatTitle,
		subscribeToRuntime: ({ branchId, database, runtimeSession, sessionId }) =>
			runtimeSession.subscribe((event) => {
				runtimeEventHandler.handle({
					branchId,
					database,
					event,
					sessionId,
				});
			}),
	});

	const openSession: PiSessionLifecycle['openSession'] = (request) =>
		opener.openSession({ database: requireDatabase(), request });

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

		// Capture the pre-prompt file state before the runtime can touch files.
		// Runs after the session map update so a concurrent submit/stop never
		// observes a turn that exists in SQLite but not in activeSessions.
		// The port owns the warn-and-continue failure policy (ADR 0012).
		if (captureCheckpoint) {
			await captureCheckpoint({
				cwd: active.row.cwd,
				database,
				label: summarizePromptForLabel(request.prompt),
				piSessionId: request.sessionId,
				turnId: turn.id,
				workspaceId: active.row.workspaceId,
			});
		}

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

/** First line of the prompt, trimmed to a short checkpoint label. */
function summarizePromptForLabel(prompt: string): string {
	const firstLine =
		prompt.split('\n').find((line) => line.trim().length > 0) ?? '';
	const trimmed = firstLine.trim();
	if (trimmed.length === 0) {
		return 'Checkpoint';
	}
	return trimmed.length > 80 ? `${trimmed.slice(0, 79)}…` : trimmed;
}
