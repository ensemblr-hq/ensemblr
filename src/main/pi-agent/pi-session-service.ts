import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { PiChatTabWire, PiSessionEventWire, PiSessionSnapshotWire, WriteForkSummaryRequest, WriteForkSummaryResult } from '../../shared/ipc/contracts/pi-session';
import type { CheckpointCapturePort } from '../checkpoints/checkpoint-service.ts';
import {
	createCheckpointCapture,
	isOrdinalHidden,
	readHiddenEventRanges,
} from '../checkpoints/checkpoint-service.ts';
import {
	type EnsembleDatabaseService,
	requireDatabase,
} from '../storage/database.ts';
import { listOpenChatTabs } from '../storage/repositories/chat-tab-repository.ts';
import {
	listEventsByBranch,
	type PiEventRow,
} from '../storage/repositories/pi-event-repository.ts';
import {
	getMainBranchForSession,
	getPiSessionBranchById,
	getPiSessionById,
	listPiSessionsByWorkspace,
	type PiSessionBranchRow,
	type PiSessionRow,
	type PiTurnRow,
} from '../storage/repositories/pi-session-repository.ts';
import type { PiAgentClient } from './pi-agent-client.ts';
import {
	CHAT_TITLE_TIMEOUT_MS,
	queueChatTitleGeneration,
} from './pi-chat-title-service.ts';
import {
	createPiSessionLifecycle,
	type OpenPiSessionRequest,
	type StopPiSessionRequest,
	type SubmitPiPromptRequest,
	type SubmitPiPromptResult,
	toSnapshot,
} from './pi-session-lifecycle.ts';
import { persistRuntimeEvent } from './pi-session-persistence.ts';
import { PiSessionServiceError } from './pi-session-service-error.ts';
import type {
	PiSessionEventSink,
	PiSessionSnapshot,
} from './pi-session-types.ts';
import type { SessionSummaryWriter } from './session-summary-writer.ts';

export type {
	OpenPiSessionRequest,
	StopPiSessionRequest,
	SubmitPiPromptRequest,
	SubmitPiPromptResult,
} from './pi-session-lifecycle.ts';
export {
	PiSessionServiceError,
	type PiSessionServiceErrorCode,
} from './pi-session-service-error.ts';
export type {
	PiSessionEventSink,
	PiSessionSnapshot,
} from './pi-session-types.ts';

export interface PiSessionServiceOptions {
	/** Override for tests; defaults to the git-backed capture (ADR 0012). */
	captureCheckpoint?: CheckpointCapturePort;
	chatTitleTimeoutMs?: number;
	databaseService: EnsembleDatabaseService;
	eventSink?: PiSessionEventSink;
	piAgentClient: PiAgentClient;
	sessionSummaryWriter?: SessionSummaryWriter;
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
	writeForkSummary: (
		request: WriteForkSummaryRequest,
	) => Promise<WriteForkSummaryResult>;
}

/**
 * Coordinates Pi runtime sessions with their SQLite persistence: opens a
 * session in the PiAgentClient, creates the matching `pi_sessions` row, and
 * mirrors every `PiAgentEvent` into `pi_session_events` for later rehydration.
 *
 * Composes three collaborators wired by dependency injection:
 *   - {@link createPiSessionLifecycle} — open/submit/stop/runtime-event state machine
 *   - {@link persistRuntimeEvent} — discriminant mapping into `pi_session_events`
 *   - {@link queueChatTitleGeneration} — best-effort LLM tab title generation
 *   - `sessionSummaryWriter` — optional live summary updates after agent turns
 */
export function createPiSessionService({
	captureCheckpoint = createCheckpointCapture(),
	chatTitleTimeoutMs = CHAT_TITLE_TIMEOUT_MS,
	databaseService,
	eventSink,
	piAgentClient,
	sessionSummaryWriter,
	now = () => new Date(),
}: PiSessionServiceOptions): PiSessionService {
	const requireSessionDatabase = (): DatabaseSync =>
		requireDatabase(
			databaseService.getConnection()?.database,
			() =>
				new PiSessionServiceError({
					code: 'database-unavailable',
					message: 'Database is not open; cannot manage Pi sessions.',
				}),
		);

	const lifecycle = createPiSessionLifecycle({
		captureCheckpoint,
		chatTitleTimeoutMs,
		eventSink,
		now,
		persistRuntimeEvent,
		piAgentClient,
		queueChatTitle: queueChatTitleGeneration,
		requireDatabase: requireSessionDatabase,
		sessionSummaryWriter,
	});

	return {
		getSession: (sessionId) => {
			const database = requireSessionDatabase();
			const active = lifecycle.getActiveSession(sessionId);
			if (active) {
				return toSnapshot({
					branchId: active.branch.id,
					database,
					row: active.row,
					runtimeOpen: true,
				});
			}
			const row = getPiSessionById({ database, id: sessionId });
			if (!row) {
				return null;
			}
			const mainBranch = getMainBranchForSession({
				database,
				piSessionId: row.id,
			});
			if (!mainBranch) {
				return null;
			}
			return toSnapshot({
				branchId: mainBranch.id,
				database,
				row,
				runtimeOpen: false,
			});
		},
		listEvents: (branchId) => {
			const database = requireSessionDatabase();
			const events = listEventsByBranch({ branchId, database });
			// Checkpoint restores hide (never delete) the overwritten turns.
			const branch = getPiSessionBranchById({ database, id: branchId });
			const hiddenRanges = branch ? readHiddenEventRanges(branch.metadata) : [];
			if (hiddenRanges.length === 0) {
				return events;
			}
			return events.filter(
				(event) => !isOrdinalHidden(event.ordinal, hiddenRanges),
			);
		},
		listSessionsForWorkspace: (workspaceId) => {
			const database = requireSessionDatabase();
			const rows = listPiSessionsByWorkspace({ database, workspaceId });
			const openedTabs = listOpenChatTabs({ database, workspaceId });
			return rows
				.map((row) => {
					const mainBranch = getMainBranchForSession({
						database,
						piSessionId: row.id,
					});
					if (!mainBranch) {
						return null;
					}
					return toSnapshot({
						branchId: mainBranch.id,
						database,
						openedTabs,
						row,
						runtimeOpen: lifecycle.getActiveSession(row.id) !== null,
					});
				})
				.filter((snapshot): snapshot is PiSessionSnapshot => snapshot !== null);
		},
		openSession: lifecycle.openSession,
		shutdown: async () => {
			await lifecycle.shutdownActiveSessions();
			await piAgentClient.shutdown();
		},
		stopSession: lifecycle.stopSession,
		submitPrompt: lifecycle.submitPrompt,
		writeForkSummary: async (request) => {
			if (!sessionSummaryWriter) {
				return { error: 'Summary writer is not configured.' };
			}
			const database = requireSessionDatabase();
			const row = getPiSessionById({ database, id: request.sessionId });
			if (!row) {
				return { error: `No Pi session found for id ${request.sessionId}.` };
			}
			const targetCwd = request.targetWorkspaceCwd ?? row.cwd;
			const events: PiSessionEventWire[] = listEventsByBranch({
				branchId: request.branchId,
				database,
			}).flatMap((event) =>
				request.upToOrdinal === undefined ||
				event.ordinal <= request.upToOrdinal
					? [
							{
								branchId: event.branchId,
								createdAt: event.createdAt,
								eventType: event.eventType,
								id: event.id,
								ordinal: event.ordinal,
								payload: event.payload,
								stream: event.stream,
								turnId: event.turnId,
							},
						]
					: [],
			);
			try {
				const result = await sessionSummaryWriter.writeSessionSummary({
					branchId: request.branchId,
					chatTabId: request.fileBaseName,
					closedAt: now().toISOString(),
					events,
					// `fork-` prefix keeps the file clear of the destination tab's
					// own live summary (`<chatTabId>.md`).
					fileBaseName: `fork-${request.fileBaseName}`,
					piSessionId: row.piSessionId,
					purpose: 'fork',
					workspaceCwd: targetCwd,
				});
				return {
					summary: {
						absolutePath: result.path,
						relativePath: path.relative(targetCwd, result.path),
						title: result.title,
					},
				};
			} catch (error) {
				return {
					error:
						error instanceof Error
							? error.message
							: 'Failed to write fork summary.',
				};
			}
		},
	};
}

/**
 * Maps a {@link PiSessionSnapshot} to the renderer-facing wire shape. Lives in
 * the service so adding a wire field surfaces a compile error here rather than
 * silently dropping data in the IPC layer.
 */
export function snapshotToWire(
	snapshot: PiSessionSnapshot,
): PiSessionSnapshotWire {
	const tabs: PiChatTabWire[] = snapshot.openedTabs.map((tab) => ({
		id: tab.id,
		kind: tab.kind,
		openedAt: tab.openedAt,
		piSessionId: tab.piSessionId,
		position: tab.position,
		title: tab.title,
		workspaceId: tab.workspaceId,
	}));
	return {
		branchId: snapshot.branchId,
		closedAt: snapshot.closedAt,
		createdAt: snapshot.createdAt,
		cwd: snapshot.cwd,
		id: snapshot.id,
		label: snapshot.label,
		model: snapshot.model,
		openedTabs: tabs,
		piSessionId: snapshot.piSessionId,
		runtimeOpen: snapshot.runtimeOpen,
		status: snapshot.status,
		thinkingLevel: snapshot.thinkingLevel,
		updatedAt: snapshot.updatedAt,
		workspaceId: snapshot.workspaceId,
	};
}

export type { PiSessionBranchRow, PiSessionRow, PiTurnRow };
