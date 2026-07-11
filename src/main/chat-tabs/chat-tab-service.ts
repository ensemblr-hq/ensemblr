import type { DatabaseSync } from 'node:sqlite';

import {
	CHAT_TAB_LIMIT,
	CHAT_TAB_LIMIT_ERROR_CODE,
} from '../../shared/ipc/contracts/chat-tab.ts';
import {
	parseWorkspaceGitDiffScope,
	serializeWorkspaceGitDiffScope,
} from '../../shared/ipc/contracts/workspace-git.ts';
import { resolveSessionSummaryPath } from '../pi-agent/session-summary-writer.ts';
import type { EnsemblrDatabaseService } from '../storage';
import { requireDatabase } from '../storage/database.ts';
import {
	bindPiSession,
	type ChatTabKind,
	type ChatTabRow,
	deleteChatTab,
	getChatTabById,
	listClosedForWorkspace,
	listOpenForWorkspace,
	markClosed,
	openChatTab,
	reorderChatTabs,
	restoreClosedChatTab,
} from '../storage/repositories/index.ts';

/** Thrown when opening a sixth chat tab; carries a renderer-detectable marker. */
export class ChatTabLimitError extends Error {
	constructor() {
		super(
			`${CHAT_TAB_LIMIT_ERROR_CODE}: at most ${CHAT_TAB_LIMIT} chat tabs can be open per workspace. Close a chat tab to open a new one.`,
		);
		this.name = 'ChatTabLimitError';
	}
}

/**
 * Cross-table lookups the chat-tab service needs without owning SQL for other
 * domains. Default implementation is built in `main.ts` from the storage
 * data-access layer; tests can pass a stub.
 */
interface ChatTabLookups {
	/** Returns `true` when a Pi session exists for the given id. */
	piSessionExists: (input: { piSessionId: string }) => boolean;
	/** Returns the workspace's on-disk cwd, or `null` when absent. */
	workspaceCwd: (input: { workspaceId: string }) => string | null;
}

/** A closed tab joined with its session-summary location and title. */
interface ClosedChatTabEntry {
	closedAt: string;
	summaryPath: string;
	summaryTitle: string | null;
	tab: ChatTabRow;
}

/** Public surface of the chat-tab service used by IPC handlers. */
export interface ChatTabService {
	bindPiSession: (input: { chatTabId: string; piSessionId: string }) => void;
	closeTab: (input: { chatTabId: string }) => { deleted: boolean };
	listClosedWithSummary: (input: {
		workspaceId: string;
	}) => ClosedChatTabEntry[];
	listTabs: (input: { workspaceId: string }) => {
		closed: readonly ChatTabRow[];
		open: readonly ChatTabRow[];
	};
	openTab: (input: {
		kind?: ChatTabKind;
		metadata?: Record<string, unknown>;
		piSessionId?: string | null;
		title?: string;
		workspaceId: string;
	}) => ChatTabRow;
	reorderTabs: (input: {
		orderedIds: readonly string[];
		workspaceId: string;
	}) => readonly ChatTabRow[];
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
}: {
	databaseService: EnsemblrDatabaseService;
	lookups: ChatTabLookups;
}): ChatTabService {
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
				return { deleted: false };
			}

			// Non-chat tabs (file/diff/document/preview) carry no session history:
			// they are exempt from the min-one rule and hard-deleted on close.
			if (existing.kind !== 'chat') {
				deleteChatTab({ database, id: chatTabId });
				return { deleted: true };
			}

			const openChatTabs = listOpenForWorkspace({
				database,
				workspaceId: existing.workspaceId,
			}).filter((tab) => tab.kind === 'chat');
			if (openChatTabs.length <= 1) {
				return { deleted: false };
			}

			if (isEmptyChatTab(existing)) {
				deleteChatTab({ database, id: chatTabId });
				return { deleted: true };
			}

			const closedTab = markClosed({ database, id: chatTabId });
			if (!closedTab) {
				throw new Error(`Failed to close chat tab ${chatTabId}.`);
			}
			return { deleted: false };
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
		openTab: ({ kind = 'chat', metadata, piSessionId, title, workspaceId }) => {
			const database = requireChatTabDatabase();
			const openTabs = listOpenForWorkspace({ database, workspaceId });

			if (kind === 'chat') {
				const openChatTabCount = openTabs.filter(
					(tab) => tab.kind === 'chat',
				).length;
				if (openChatTabCount >= CHAT_TAB_LIMIT) {
					throw new ChatTabLimitError();
				}
			} else {
				// Re-focus instead of duplicating when the same subject is already
				// open (e.g. clicking the same attachment chip twice).
				const subject = readMetadataSubject(metadata);
				const existing = subject
					? openTabs.find(
							(tab) =>
								tab.kind === kind &&
								readMetadataSubject(tab.metadata) === subject,
						)
					: undefined;
				if (existing) {
					return existing;
				}
			}

			return openChatTab({
				database,
				input: {
					kind,
					metadata,
					piSessionId: piSessionId ?? null,
					title: title?.trim() || DEFAULT_TAB_TITLE,
					workspaceId,
				},
			});
		},
		reorderTabs: ({ orderedIds, workspaceId }) => {
			const database = requireChatTabDatabase();
			const openTabs = listOpenForWorkspace({ database, workspaceId });
			return reorderChatTabs({
				database,
				orderedIds: reconcileOpenTabOrder({ openTabs, orderedIds }),
				workspaceId,
			});
		},
		restoreTab: ({ chatTabId }) => {
			const database = requireChatTabDatabase();
			return restoreClosedChatTab({ database, id: chatTabId });
		},
	};
}

/** Reconciles a drag payload with the current open tab rows before persisting. */
function reconcileOpenTabOrder({
	openTabs,
	orderedIds,
}: {
	openTabs: readonly ChatTabRow[];
	orderedIds: readonly string[];
}): string[] {
	const openTabIds = new Set(openTabs.map((tab) => tab.id));
	const seenOrderedIds = new Set<string>();
	const knownOrderedIds = orderedIds.filter((id) => {
		if (!openTabIds.has(id) || seenOrderedIds.has(id)) {
			return false;
		}
		seenOrderedIds.add(id);
		return true;
	});

	return [
		...knownOrderedIds,
		...openTabs.map((tab) => tab.id).filter((id) => !seenOrderedIds.has(id)),
	];
}

/** True when a tab has no attached Pi session and should not enter history. */
function isEmptyChatTab(tab: ChatTabRow): boolean {
	return tab.piSessionId === null;
}

/**
 * Identity of a non-chat tab's subject. Diff tabs are keyed by their diff scope
 * *and* file path, so the same file viewed at the working tree, in a specific
 * commit, and across the whole branch each get their own tab instead of
 * stealing focus from one another. Turn diffs (no file path) key on the turn id.
 */
function readMetadataSubject(
	metadata: Record<string, unknown> | undefined,
): string | null {
	const filePath = metadata?.filePath;
	if (typeof filePath === 'string' && filePath.length > 0) {
		const scopeKey = serializeWorkspaceGitDiffScope(
			parseWorkspaceGitDiffScope(metadata?.diffScope),
		);
		return `${scopeKey}::${filePath}`;
	}
	const turnId = metadata?.turnId;
	return typeof turnId === 'string' && turnId.length > 0 ? turnId : null;
}

/**
 * Read the summary title stored on a session-event metadata record.
 * @param metadata - Parsed event metadata record
 * @returns The summary title, or null when the record has no string title
 */
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
