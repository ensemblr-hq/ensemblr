import type { DatabaseSync } from 'node:sqlite';

import { resolveSessionSummaryPath } from '../pi-agent/session-summary-writer.ts';
import {
	type EnsembleDatabaseService,
	requireDatabase,
} from '../storage/database.ts';
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
} from '../storage/repositories/chat-tab-repository.ts';

/**
 * Cross-table lookups the chat-tab service needs without owning SQL for other
 * domains. Default implementation is built in `main.ts` from the storage
 * data-access layer; tests can pass a stub.
 */
export interface ChatTabLookups {
	/** Returns `true` when a Pi session exists for the given id. */
	piSessionExists: (input: { piSessionId: string }) => boolean;
	/** Returns the workspace's on-disk cwd, or `null` when absent. */
	workspaceCwd: (input: { workspaceId: string }) => string | null;
}

/** Dependencies for {@link createChatTabService}. */
export interface ChatTabServiceOptions {
	databaseService: EnsembleDatabaseService;
	lookups: ChatTabLookups;
}

/** A closed tab joined with its session-summary location and title. */
export interface ClosedChatTabEntry {
	closedAt: string;
	summaryPath: string;
	summaryTitle: string | null;
	tab: ChatTabRow;
}

/** Public surface of the chat-tab service used by IPC handlers. */
export interface ChatTabService {
	bindPiSession: (input: { chatTabId: string; piSessionId: string }) => void;
	closeTab: (input: { chatTabId: string }) => void;
	listClosedWithSummary: (input: {
		workspaceId: string;
	}) => ClosedChatTabEntry[];
	listTabs: (input: { workspaceId: string }) => {
		closed: readonly ChatTabRow[];
		open: readonly ChatTabRow[];
	};
	openTab: (input: {
		piSessionId?: string | null;
		title?: string;
		workspaceId: string;
	}) => ChatTabRow;
	restoreTab: (input: { chatTabId: string }) => ChatTabRow | null;
}

const DEFAULT_TAB_TITLE = 'New chat';

/**
 * Owns chat-tab lifecycle policy: idempotent close, the minimum-one-open-tab
 * rule, empty-tab deletion, and closed-tab history with summary locations.
 */
export function createChatTabService({
	databaseService,
	lookups,
}: ChatTabServiceOptions): ChatTabService {
	const requireChatTabDatabase = (): DatabaseSync =>
		requireDatabase(
			databaseService.getConnection()?.database,
			() => new Error('Database is not open; cannot manage chat tabs.'),
		);

	return {
		bindPiSession: ({ chatTabId, piSessionId }) => {
			const database = requireChatTabDatabase();
			const existing = getChatTabById({ database, id: chatTabId });
			if (!existing) {
				throw new Error(`Chat tab ${chatTabId} does not exist.`);
			}
			if (!lookups.piSessionExists({ piSessionId })) {
				throw new Error(`Pi session ${piSessionId} does not exist.`);
			}
			bindPiSession({ database, id: chatTabId, piSessionId });
		},
		closeTab: ({ chatTabId }) => {
			const database = requireChatTabDatabase();
			const existing = getChatTabById({ database, id: chatTabId });
			// Idempotent: treat unknown or already-closed tabs as no-ops so a
			// duplicate close (e.g. after cache invalidation) does not surface
			// as a renderer error.
			if (!existing || existing.closedAt !== null) {
				return;
			}

			const openTabs = listOpenForWorkspace({
				database,
				workspaceId: existing.workspaceId,
			});
			if (openTabs.length <= 1) {
				return;
			}

			if (isEmptyChatTab(existing)) {
				deleteChatTab({ database, id: chatTabId });
				return;
			}

			const closedTab = markClosed({ database, id: chatTabId });
			if (!closedTab) {
				throw new Error(`Failed to close chat tab ${chatTabId}.`);
			}
		},
		listClosedWithSummary: ({ workspaceId }) => {
			const database = requireChatTabDatabase();
			const workspaceCwd = lookups.workspaceCwd({ workspaceId });
			const closed = listClosedForWorkspace({ database, workspaceId });

			return closed
				.filter((tab) => tab.closedAt !== null)
				.map((tab) => ({
					closedAt: tab.closedAt ?? '',
					summaryPath: workspaceCwd
						? resolveSessionSummaryPath({
								fileBaseName: tab.id,
								workspaceCwd,
							})
						: '',
					summaryTitle: readSummaryTitleFromMetadata(tab.metadata),
					tab,
				}));
		},
		listTabs: ({ workspaceId }) => {
			const database = requireChatTabDatabase();
			return {
				closed: listClosedForWorkspace({ database, workspaceId }),
				open: listOpenForWorkspace({ database, workspaceId }),
			};
		},
		openTab: ({ piSessionId, title, workspaceId }) => {
			const database = requireChatTabDatabase();
			return openChatTab({
				database,
				input: {
					kind: 'chat',
					piSessionId: piSessionId ?? null,
					title: title?.trim() || DEFAULT_TAB_TITLE,
					workspaceId,
				},
			});
		},
		restoreTab: ({ chatTabId }) => {
			const database = requireChatTabDatabase();
			return restoreClosedChatTab({ database, id: chatTabId });
		},
	};
}

/** True when a tab has no attached Pi session and should not enter history. */
function isEmptyChatTab(tab: ChatTabRow): boolean {
	return tab.piSessionId === null;
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
