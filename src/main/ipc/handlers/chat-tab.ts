import type { DatabaseSync } from 'node:sqlite';
import { ipcMain } from 'electron';

import {
	type BindPiSessionToTabResult,
	type ChatTabWire,
	type CloseChatTabResult,
	type ClosedChatTabEntryWire,
	IPC_CHANNELS,
	type ListChatTabsResult,
	type ListClosedChatTabsWithSummaryResult,
	type OpenChatTabResult,
	type PiSessionEventWire,
	type RestoreChatTabResult,
} from '../../../shared/ipc';
import type {
	SessionSummaryWriter,
	WriteSessionSummaryResult,
} from '../../pi-agent/session-summary-writer.ts';
import type { EnsembleDatabaseService } from '../../storage/database.ts';
import {
	bindPiSession,
	type ChatTabRow,
	deleteChatTab,
	getChatTabById,
	listClosedForWorkspace,
	listOpenForWorkspace,
	markClosed,
	openChatTab,
	restoreClosedChatTab,
} from '../../storage/repositories/chat-tab-repository.ts';
import { listEventsByBranch } from '../../storage/repositories/pi-event-repository.ts';
import {
	getPiSessionById,
	listPiSessionBranches,
} from '../../storage/repositories/pi-session-repository.ts';
import {
	bindPiSessionToChatTabRequestSchema,
	closeChatTabRequestSchema,
	listChatTabsRequestSchema,
	listClosedChatTabsWithSummaryRequestSchema,
	openChatTabRequestSchema,
	restoreChatTabRequestSchema,
} from '../request-schemas.ts';

/** Service dependencies for the chat-tab IPC handlers. */
export interface ChatTabHandlersOptions {
	databaseService: EnsembleDatabaseService;
	sessionSummaryWriter: SessionSummaryWriter;
}

const DEFAULT_TAB_TITLE = 'New chat';

/**
 * Registers IPC handlers exposing chat-tab CRUD + session summary writing to
 * the renderer. The summary writer is injected so production can supply an
 * LLM-backed implementation while tests inject a deterministic stub.
 */
export function registerChatTabHandlers({
	databaseService,
	sessionSummaryWriter,
}: ChatTabHandlersOptions): void {
	const requireDatabase = (): DatabaseSync => {
		const connection = databaseService.getConnection();
		if (!connection) {
			throw new Error('Database is not open; cannot manage chat tabs.');
		}
		return connection.database;
	};

	ipcMain.handle(
		IPC_CHANNELS.listChatTabs,
		async (_event, raw: unknown): Promise<ListChatTabsResult> => {
			const request = listChatTabsRequestSchema.parse(raw);
			const database = requireDatabase();
			const open = listOpenForWorkspace({
				database,
				workspaceId: request.workspaceId,
			});
			const closed = listClosedForWorkspace({
				database,
				workspaceId: request.workspaceId,
			});
			return {
				closed: closed.map(toWire),
				open: open.map(toWire),
			};
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.openChatTab,
		async (_event, raw: unknown): Promise<OpenChatTabResult> => {
			const request = openChatTabRequestSchema.parse(raw);
			const database = requireDatabase();
			const tab = openChatTab({
				database,
				input: {
					kind: 'chat',
					piSessionId: request.piSessionId ?? null,
					title: request.title?.trim() || DEFAULT_TAB_TITLE,
					workspaceId: request.workspaceId,
				},
			});
			return { tab: toWire(tab) };
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.closeChatTab,
		async (_event, raw: unknown): Promise<CloseChatTabResult> => {
			const request = closeChatTabRequestSchema.parse(raw);
			const database = requireDatabase();
			const existing = getChatTabById({
				database,
				id: request.chatTabId,
			});
			if (!existing) {
				// Idempotent: treat unknown tab as already-closed no-op so a
				// duplicate close (e.g. after cache invalidation) does not
				// surface as a renderer error.
				return { ok: true };
			}
			if (existing.closedAt !== null) {
				return { ok: true };
			}

			const openTabs = listOpenForWorkspace({
				database,
				workspaceId: existing.workspaceId,
			});
			if (openTabs.length <= 1) {
				return { ok: true };
			}

			if (isEmptyChatTab(existing)) {
				deleteChatTab({ database, id: request.chatTabId });
				return { ok: true };
			}

			const closedTab = markClosed({ database, id: request.chatTabId });
			if (!closedTab) {
				throw new Error(`Failed to close chat tab ${request.chatTabId}.`);
			}

			void writeSummaryIfPossible({
				database,
				sessionSummaryWriter,
				tab: closedTab,
			});

			return { ok: true };
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.restoreChatTab,
		async (_event, raw: unknown): Promise<RestoreChatTabResult> => {
			const request = restoreChatTabRequestSchema.parse(raw);
			const database = requireDatabase();
			const restored = restoreClosedChatTab({
				database,
				id: request.chatTabId,
			});
			return { tab: restored ? toWire(restored) : null };
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.bindPiSessionToChatTab,
		async (_event, raw: unknown): Promise<BindPiSessionToTabResult> => {
			const request = bindPiSessionToChatTabRequestSchema.parse(raw);
			const database = requireDatabase();
			const existing = getChatTabById({ database, id: request.chatTabId });
			if (!existing) {
				throw new Error(`Chat tab ${request.chatTabId} does not exist.`);
			}
			const session = getPiSessionById({
				database,
				id: request.piSessionId,
			});
			if (!session) {
				throw new Error(`Pi session ${request.piSessionId} does not exist.`);
			}
			bindPiSession({
				database,
				id: request.chatTabId,
				piSessionId: request.piSessionId,
			});
			return { ok: true };
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.listClosedChatTabsWithSummary,
		async (
			_event,
			raw: unknown,
		): Promise<ListClosedChatTabsWithSummaryResult> => {
			const request = listClosedChatTabsWithSummaryRequestSchema.parse(raw);
			const database = requireDatabase();
			const workspaceCwd = lookupWorkspacePath({
				database,
				workspaceId: request.workspaceId,
			});
			const closed = listClosedForWorkspace({
				database,
				workspaceId: request.workspaceId,
			});

			const entries: ClosedChatTabEntryWire[] = closed
				.filter((tab) => tab.closedAt !== null)
				.map((tab) => ({
					closedAt: tab.closedAt ?? '',
					summaryPath: workspaceCwd
						? buildSummaryPath({ tabId: tab.id, workspaceCwd })
						: '',
					summaryTitle: readSummaryTitleFromMetadata(tab.metadata),
					tab: toWire(tab),
				}));

			return { entries };
		},
	);
}

/** True when a tab has no attached Pi session and should not enter history. */
function isEmptyChatTab(tab: ChatTabRow): boolean {
	return tab.piSessionId === null;
}

interface WriteSummaryArgs {
	database: DatabaseSync;
	sessionSummaryWriter: SessionSummaryWriter;
	tab: ChatTabRow;
}

async function writeSummaryIfPossible({
	database,
	sessionSummaryWriter,
	tab,
}: WriteSummaryArgs): Promise<void> {
	const workspaceCwd = lookupWorkspacePath({
		database,
		workspaceId: tab.workspaceId,
	});
	if (!workspaceCwd) {
		console.warn(
			'[chat-tab] Skipping summary write: workspace cwd unresolved.',
			{ workspaceId: tab.workspaceId },
		);
		return;
	}

	const { branchId, events } = collectEventsForTab({ database, tab });
	const closedAt = tab.closedAt ?? new Date().toISOString();

	let result: WriteSessionSummaryResult | null = null;
	try {
		result = await sessionSummaryWriter.writeSessionSummary({
			branchId,
			chatTabId: tab.id,
			closedAt,
			events,
			piSessionId: tab.piSessionId,
			workspaceCwd,
		});
	} catch (cause) {
		console.warn('[chat-tab] writeSessionSummary failed.', {
			cause: cause instanceof Error ? cause.message : String(cause),
			chatTabId: tab.id,
		});
		return;
	}

	if (!result) {
		return;
	}

	// Stash the summary metadata in the tab row so later listings can render
	// titles without re-reading the markdown file.
	const nextMetadata = {
		...tab.metadata,
		summary: {
			path: result.path,
			title: result.title,
			usedLlm: result.usedLlm,
		},
	};
	try {
		database
			.prepare(`UPDATE chat_tabs SET metadata_json = ? WHERE id = ?`)
			.run(JSON.stringify(nextMetadata), tab.id);
	} catch (cause) {
		console.warn('[chat-tab] Failed to persist summary metadata.', {
			cause: cause instanceof Error ? cause.message : String(cause),
			chatTabId: tab.id,
		});
	}
}

interface CollectEventsArgs {
	database: DatabaseSync;
	tab: ChatTabRow;
}

interface CollectedEvents {
	branchId: string | null;
	events: readonly PiSessionEventWire[];
}

function collectEventsForTab({
	database,
	tab,
}: CollectEventsArgs): CollectedEvents {
	if (!tab.piSessionId) {
		return { branchId: null, events: [] };
	}
	const branches = listPiSessionBranches({
		database,
		piSessionId: tab.piSessionId,
	});
	const mainBranch =
		branches.find((branch) => branch.kind === 'main') ?? branches[0];
	if (!mainBranch) {
		return { branchId: null, events: [] };
	}
	const rows = listEventsByBranch({ branchId: mainBranch.id, database });
	const events: PiSessionEventWire[] = rows.map((row) => ({
		branchId: row.branchId,
		createdAt: row.createdAt,
		eventType: row.eventType,
		id: row.id,
		ordinal: row.ordinal,
		payload: row.payload,
		stream: row.stream,
		turnId: row.turnId,
	}));
	return { branchId: mainBranch.id, events };
}

function lookupWorkspacePath({
	database,
	workspaceId,
}: {
	database: DatabaseSync;
	workspaceId: string;
}): string | null {
	const row = database
		.prepare(`SELECT path FROM workspaces WHERE id = ?`)
		.get(workspaceId) as { path: string } | undefined;
	return row?.path ?? null;
}

function buildSummaryPath({
	tabId,
	workspaceCwd,
}: {
	tabId: string;
	workspaceCwd: string;
}): string {
	return `${workspaceCwd}/.context/sessions/${tabId}.md`;
}

function readSummaryTitleFromMetadata(
	metadata: Record<string, unknown>,
): string | null {
	const summary = metadata.summary;
	if (!summary || typeof summary !== 'object') {
		return null;
	}
	const candidate = (summary as { title?: unknown }).title;
	return typeof candidate === 'string' ? candidate : null;
}

function toWire(row: ChatTabRow): ChatTabWire {
	return {
		closedAt: row.closedAt,
		id: row.id,
		kind: row.kind,
		openedAt: row.openedAt,
		piSessionId: row.piSessionId,
		position: row.position,
		title: row.title,
		workspaceId: row.workspaceId,
	};
}
