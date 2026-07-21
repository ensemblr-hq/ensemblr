import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import {
	CHAT_TAB_LIMIT,
	CHAT_TAB_LIMIT_ERROR_CODE,
} from '../../shared/ipc/contracts/chat-tab.ts';
import {
	parseWorkspaceGitDiffScope,
	serializeWorkspaceGitDiffScope,
} from '../../shared/ipc/contracts/workspace-git.ts';
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
	renameChatTab,
	reorderChatTabs,
	restoreClosedChatTab,
	setChatTabMetadata,
} from '../storage/repositories/chat-tab-repository.ts';

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
	closeTab: (input: {
		chatTabId: string;
		metadataPatch?: Record<string, unknown>;
		title?: string;
	}) => { deleted: boolean };
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
		closeTab: ({ chatTabId, metadataPatch, title }) => {
			const database = requireChatTabDatabase();
			const existing = getChatTabById({ database, id: chatTabId });
			// Idempotent: treat unknown or already-closed tabs as no-ops so a
			// duplicate close (e.g. after cache invalidation) does not surface
			// as a renderer error.
			if (!existing || existing.closedAt !== null) {
				return { deleted: false };
			}

			// Terminal (harness) tabs carry a resumable conversation, so they are
			// archived as restorable rather than deleted.
			if (existing.kind === 'terminal') {
				archiveTerminalTab({ database, existing, metadataPatch, title });
				return { deleted: false };
			}

			// Other non-chat tabs (file/diff/document/preview) carry no session
			// history: they are exempt from the min-one rule and hard-deleted.
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
			return listClosedForWorkspace({ database, workspaceId })
				.map(toClosedEntry)
				.filter((entry): entry is ClosedChatTabEntry => entry !== null);
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

/**
 * Archives a terminal (harness) tab as restorable, stamping its final title and
 * merging the metadata patch (e.g. the native session id) so the closed-history
 * row shows the right label and a restore can reattach the exact conversation.
 * @param options - The open database, the tab row, and the optional title/metadata.
 */
function archiveTerminalTab({
	database,
	existing,
	metadataPatch,
	title,
}: {
	database: DatabaseSync;
	existing: ChatTabRow;
	metadataPatch?: Record<string, unknown>;
	title?: string;
}): void {
	const closed = markClosed({ database, id: existing.id });
	if (!closed) {
		throw new Error(`Failed to close chat tab ${existing.id}.`);
	}
	if (title?.trim()) {
		renameChatTab({ database, id: existing.id, title: title.trim() });
	}
	if (metadataPatch) {
		setChatTabMetadata({
			database,
			id: existing.id,
			metadata: { ...existing.metadata, ...metadataPatch },
		});
	}
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

	const orderedResult = [...knownOrderedIds];
	for (const tab of openTabs) {
		if (!seenOrderedIds.has(tab.id)) {
			orderedResult.push(tab.id);
		}
	}
	return orderedResult;
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
 * Build a transcript-picker entry for a closed tab, or null when the tab has no
 * attachable summary. A tab qualifies only when its metadata carries the summary
 * marker (persisted after a successful summary write) *and* the summary file it
 * records is still on disk. This excludes terminal/harness tabs, aborted
 * sessions, and writes that never landed — so the picker never offers a
 * transcript whose attach would fail with ENOENT. The on-disk check uses the
 * path the writer persisted (`summary.path`), not a path recomputed from the
 * workspace root, because a session's cwd can differ from the workspace root
 * (e.g. a worktree) and only the persisted path is authoritative.
 * @param tab - The closed chat-tab row
 * @returns The picker entry, or null when no summary is available
 */
function toClosedEntry(tab: ChatTabRow): ClosedChatTabEntry | null {
	if (tab.closedAt === null) {
		return null;
	}
	const summary = readSummaryFromMetadata(tab.metadata);
	if (!summary || !existsSync(summary.path)) {
		return null;
	}
	return {
		closedAt: tab.closedAt,
		summaryPath: summary.path,
		summaryTitle: summary.title,
		tab,
	};
}

/**
 * Read the persisted session-summary marker from a tab's metadata. Present only
 * after a summary write succeeded (see `persistSummaryMetadata`); absent for
 * terminal tabs and chat tabs whose summary write never ran. Requires a
 * non-empty `path` so callers can verify the recorded file still exists.
 * @param metadata - Parsed chat-tab metadata record
 * @returns The summary marker with its path and title, or null when no usable marker is present
 */
function readSummaryFromMetadata(
	metadata: Record<string, unknown>,
): { path: string; title: string | null } | null {
	const summary = metadata.summary;
	if (!summary || typeof summary !== 'object') {
		return null;
	}
	const record = summary as { path?: unknown; title?: unknown };
	if (typeof record.path !== 'string' || record.path.length === 0) {
		return null;
	}
	return {
		path: record.path,
		title: typeof record.title === 'string' ? record.title : null,
	};
}
