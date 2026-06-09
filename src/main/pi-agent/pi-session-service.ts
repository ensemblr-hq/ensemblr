import type { DatabaseSync } from 'node:sqlite';
import type {
	PiChatTabWire,
	PiSessionSnapshotWire,
} from '../../shared/ipc/contracts/pi-session.ts';
import type { EnsembleDatabaseService } from '../storage/database.ts';
import {
	type PiEventRow,
	listEventsByBranch,
} from '../storage/repositories/pi-event-repository.ts';
import {
	getPiSessionById,
	listPiSessionBranches,
	listPiSessionsByWorkspace,
	type PiSessionBranchRow,
	type PiSessionRow,
	type PiTurnRow,
} from '../storage/repositories/pi-session-repository.ts';
import {
	CHAT_TITLE_TIMEOUT_MS,
	queueChatTitleGeneration,
} from './pi-chat-title-service.ts';
import type { PiAgentClient } from './pi-agent-client.ts';
import {
	createPiSessionLifecycle,
	type OpenPiSessionRequest,
	type StopPiSessionRequest,
	type SubmitPiPromptRequest,
	type SubmitPiPromptResult,
	toSnapshot,
} from './pi-session-lifecycle.ts';
import { persistRuntimeEvent } from './pi-session-persistence.ts';
import {
	PiSessionServiceError,
	type PiSessionServiceErrorCode,
} from './pi-session-service-error.ts';
import type {
	PiSessionEventSink,
	PiSessionSnapshot,
} from './pi-session-types.ts';

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
	chatTitleTimeoutMs?: number;
	databaseService: EnsembleDatabaseService;
	eventSink?: PiSessionEventSink;
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
 *
 * Composes three collaborators wired by dependency injection:
 *   - {@link createPiSessionLifecycle} — open/submit/stop/runtime-event state machine
 *   - {@link persistRuntimeEvent} — discriminant mapping into `pi_session_events`
 *   - {@link queueChatTitleGeneration} — best-effort LLM tab title generation
 */
export function createPiSessionService({
	chatTitleTimeoutMs = CHAT_TITLE_TIMEOUT_MS,
	databaseService,
	eventSink,
	piAgentClient,
	now = () => new Date(),
}: PiSessionServiceOptions): PiSessionService {
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

	const lifecycle = createPiSessionLifecycle({
		chatTitleTimeoutMs,
		eventSink,
		now,
		persistRuntimeEvent,
		piAgentClient,
		queueChatTitle: queueChatTitleGeneration,
		requireDatabase,
	});

	return {
		getSession: (sessionId) => {
			const database = requireDatabase();
			const active = lifecycle.getActiveSession(sessionId);
			if (active) {
				return toSnapshot({
					branchId: active.branch.id,
					database,
					row: active.row,
				});
			}
			const row = getPiSessionById({ database, id: sessionId });
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
			return toSnapshot({ branchId: mainBranch.id, database, row });
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
					return toSnapshot({ branchId: mainBranch.id, database, row });
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
		status: snapshot.status,
		thinkingLevel: snapshot.thinkingLevel,
		updatedAt: snapshot.updatedAt,
		workspaceId: snapshot.workspaceId,
	};
}

export type { PiSessionBranchRow, PiSessionRow, PiTurnRow };
