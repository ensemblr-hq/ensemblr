import { statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import {
	parseWorkspaceGitDiffScope,
	serializeWorkspaceGitDiffScope,
} from '../../shared/ipc/contracts/workspace-git.ts';
import type { EnsemblrDatabaseService } from '../storage';
import { requireDatabase } from '../storage/database.ts';
import {
	bindAgentSession,
	type ChatTabKind,
	type ChatTabRow,
	deleteChatTab,
	getChatTabById,
	listChatTabsAcrossWorkspaces,
	listClosedForWorkspace,
	listOpenForWorkspace,
	markClosed,
	openChatTab,
	renameChatTab,
	reorderChatTabs,
	restoreClosedChatTab,
	retargetChatTab,
	setChatTabMetadata,
} from '../storage/repositories/chat-tab-repository.ts';
import {
	canPreviewKind,
	findPreviewSlot,
	isPreviewTab,
	withoutPreviewFlag,
	withPreviewFlag,
} from './preview-tab-slot.ts';

/**
 * Cross-table lookups the chat-tab service needs without owning SQL for other
 * domains. Default implementation is built in `main.ts` from the storage
 * data-access layer; tests can pass a stub.
 */
interface ChatTabLookups {
	/** Returns `true` when an agent session exists for the given id. */
	agentSessionExists: (input: { agentSessionId: string }) => boolean;
}

/**
 * A chat tab plus its session-summary location and title. `closedAt` is null
 * while the tab is still open — a live chat has a summary too, rewritten at
 * every turn boundary. `summaryPath` is empty (and `summaryTitle` /
 * `summaryUpdatedAt` null) when the tab has no attachable on-disk summary: a
 * closed tab is still listed so it can be restored, just without a transcript
 * to attach.
 */
interface ChatTabSummaryEntry {
	closedAt: string | null;
	summaryPath: string;
	summaryTitle: string | null;
	summaryUpdatedAt: string | null;
	tab: ChatTabRow;
}

/** Public surface of the chat-tab service used by IPC handlers. */
export interface ChatTabService {
	bindAgentSession: (input: {
		chatTabId: string;
		agentSessionId: string;
	}) => void;
	closeTab: (input: {
		chatTabId: string;
		fullTitle?: string;
		metadataPatch?: Record<string, unknown>;
		title?: string;
	}) => { deleted: boolean };
	/**
	 * The workspace's first chat tab nobody has used yet, for a caller that would
	 * otherwise open one beside it. Null when every open tab is named, carries a
	 * conversation, or is not a chat.
	 */
	claimIdleChatTab: (input: { workspaceId: string }) => ChatTabRow | null;
	/**
	 * Every tab of a workspace that has something to offer, newest summary first.
	 * Open tabs are included, since a live chat's summary is rewritten at each turn
	 * boundary. Closed tabs are listed whether or not a summary survives — they
	 * remain restorable, and that includes the terminal tabs the history dropdown
	 * reattaches — while an open tab with nothing recorded is dropped, being
	 * already visible in the tab strip.
	 *
	 * The ordering answers to the attach chips, which rank by transcript freshness.
	 * The history dropdown restores rather than attaches, so it re-ranks the closed
	 * entries by `closedAt` itself (`byCloseRecency` in the renderer's
	 * `session-tab-models`) rather than inheriting an order a transcript-less
	 * terminal tab cannot place in.
	 */
	listChatTabSummaries: (input: {
		workspaceId: string;
	}) => ChatTabSummaryEntry[];
	/** Every workspace's open tabs, plus the newest closed tabs under a cap. */
	listAllTabs: (input: { closedLimit: number }) => {
		closed: readonly ChatTabRow[];
		open: readonly ChatTabRow[];
	};
	listTabs: (input: { workspaceId: string }) => {
		closed: readonly ChatTabRow[];
		open: readonly ChatTabRow[];
	};
	openTab: (input: {
		/** Open tab to place the new tab right of; appends to the end when absent. */
		insertAfterChatTabId?: string | null;
		kind?: ChatTabKind;
		metadata?: Record<string, unknown>;
		agentSessionId?: string | null;
		/** Opens into the workspace's single ephemeral preview slot. */
		preview?: boolean;
		/** Blank opens the tab untitled; the renderer supplies the localized placeholder. */
		title?: string;
		workspaceId: string;
	}) => ChatTabRow;
	pinTab: (input: { chatTabId: string }) => ChatTabRow | null;
	reorderTabs: (input: {
		orderedIds: readonly string[];
		workspaceId: string;
	}) => readonly ChatTabRow[];
	restoreTab: (input: { chatTabId: string }) => ChatTabRow | null;
}

/**
 * Title stored for a tab nobody has named yet. It is empty rather than an
 * English placeholder because the row outlives every language switch: the main
 * process cannot reach the renderer's i18n instance, so a literal written here
 * would stay English in Russian and Greek forever. The renderer renders the
 * localized placeholder over the blank instead.
 */
const UNTITLED_TAB_TITLE = '';

/**
 * Metadata key that held the native harness CLI session id before it was
 * renamed to `harnessSessionId`. Read-only compatibility for pre-upgrade rows.
 */
const LEGACY_HARNESS_SESSION_ID_KEY = 'agentSessionId';

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
		bindAgentSession: ({ chatTabId, agentSessionId }) => {
			const database = requireChatTabDatabase();
			const existing = getChatTabById({ database, id: chatTabId });
			if (!existing) {
				throw new Error(`Chat tab ${chatTabId} does not exist.`);
			}
			if (!lookups.agentSessionExists({ agentSessionId })) {
				throw new Error(`Agent session ${agentSessionId} does not exist.`);
			}
			bindAgentSession({ database, id: chatTabId, agentSessionId });
		},
		closeTab: ({ chatTabId, fullTitle, metadataPatch, title }) => {
			const database = requireChatTabDatabase();
			const existing = getChatTabById({ database, id: chatTabId });
			// Idempotent: treat unknown or already-closed tabs as no-ops so a
			// duplicate close (e.g. after cache invalidation) does not surface
			// as a renderer error.
			if (!existing || existing.closedAt !== null) {
				return { deleted: false };
			}

			// Terminal (harness) tabs carry a resumable conversation, so they are
			// archived as restorable rather than deleted — but only when the harness
			// actually captured a native session id. One spawned and closed with no
			// conversation has nothing to resume, so it is hard-deleted instead of
			// entering closed history as an empty, unrestorable row.
			if (existing.kind === 'terminal') {
				if (isEmptyTerminalTab(existing, metadataPatch)) {
					deleteChatTab({ database, id: chatTabId });
					return { deleted: true };
				}
				archiveTerminalTab({
					database,
					existing,
					fullTitle,
					metadataPatch,
					title,
				});
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
		claimIdleChatTab: ({ workspaceId }) => {
			const database = requireChatTabDatabase();
			return (
				listOpenForWorkspace({ database, workspaceId }).find(isIdleChatTab) ??
				null
			);
		},
		listChatTabSummaries: ({ workspaceId }) => {
			const database = requireChatTabDatabase();
			const rows = [
				...listOpenForWorkspace({ database, workspaceId }),
				...listClosedForWorkspace({ database, workspaceId }),
			];
			return rows
				.map(toChatTabSummaryEntry)
				.filter((entry): entry is ChatTabSummaryEntry => entry !== null)
				.sort(bySummaryRecency);
		},
		listAllTabs: ({ closedLimit }) =>
			listChatTabsAcrossWorkspaces({
				closedLimit,
				database: requireChatTabDatabase(),
			}),
		listTabs: ({ workspaceId }) => {
			const database = requireChatTabDatabase();
			return {
				closed: listClosedForWorkspace({ database, workspaceId }),
				open: listOpenForWorkspace({ database, workspaceId }),
			};
		},
		openTab: ({
			insertAfterChatTabId,
			kind = 'chat',
			metadata,
			agentSessionId,
			preview = false,
			title,
			workspaceId,
		}) => {
			const database = requireChatTabDatabase();
			const openTabs = listOpenForWorkspace({ database, workspaceId });
			const resolvedTitle = title?.trim() || UNTITLED_TAB_TITLE;
			const asPreview = preview && canPreviewKind(kind);

			if (kind !== 'chat') {
				const reused = reuseOpenTab({
					asPreview,
					database,
					kind,
					metadata,
					openTabs,
					title: resolvedTitle,
				});
				if (reused) {
					return reused;
				}
			}

			return openChatTab({
				database,
				input: {
					insertAfterChatTabId: insertAfterChatTabId ?? null,
					kind,
					metadata: asPreview ? withPreviewFlag(metadata) : metadata,
					agentSessionId: agentSessionId ?? null,
					title: resolvedTitle,
					workspaceId,
				},
			});
		},
		pinTab: ({ chatTabId }) => {
			const database = requireChatTabDatabase();
			const existing = getChatTabById({ database, id: chatTabId });
			if (!existing || !isPreviewTab(existing)) {
				return existing;
			}
			return pinOpenTab({ database, tab: existing });
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
 * Whether a tab is a chat nobody has spent yet: still the kind a conversation
 * goes in, still unnamed, and with no session bound to it.
 *
 * All three conditions are load-bearing. The renderer opens one of these for
 * every workspace that has none, so an orchestrator arriving afterwards should
 * take it rather than stack a second beside it — but a tab the user titled is
 * one they meant to keep, and a tab carrying a session already has a
 * conversation in it.
 * @param tab - An open tab in the workspace.
 * @returns Whether a spawn may claim it.
 */
function isIdleChatTab(tab: ChatTabRow): boolean {
	return (
		tab.kind === 'chat' &&
		tab.agentSessionId === null &&
		tab.title === UNTITLED_TAB_TITLE
	);
}

/**
 * Resolves the already-open tab a non-chat open should land on instead of
 * adding a row: the tab already showing this subject, or — for a preview open —
 * the workspace's ephemeral preview slot retargeted at the new subject. A
 * permanent open of a subject that is currently previewed pins it, mirroring an
 * editor promoting a preview tab you opened for real.
 * @param options - The open database, the requested kind/metadata/title, the workspace's open tabs, and whether this is a preview open
 * @returns The tab to focus, or null when the open needs a new row
 */
function reuseOpenTab({
	asPreview,
	database,
	kind,
	metadata,
	openTabs,
	title,
}: {
	asPreview: boolean;
	database: DatabaseSync;
	kind: ChatTabKind;
	metadata: Record<string, unknown> | undefined;
	openTabs: readonly ChatTabRow[];
	title: string;
}): ChatTabRow | null {
	const sameSubject = findOpenTabForSubject({ kind, metadata, openTabs });
	if (sameSubject) {
		if (asPreview || !isPreviewTab(sameSubject)) {
			return sameSubject;
		}
		return pinOpenTab({ database, tab: sameSubject });
	}
	const slot = asPreview ? findPreviewSlot(openTabs) : undefined;
	if (!slot) {
		return null;
	}
	return retargetChatTab({
		database,
		id: slot.id,
		kind,
		metadata: withPreviewFlag(metadata),
		title,
	});
}

/**
 * Finds the open tab already showing a subject, so clicking the same file,
 * diff, or comment twice re-focuses instead of duplicating.
 * @param options - The requested kind and metadata plus the workspace's open tabs
 * @returns The matching open tab, or undefined when the subject is not open (or has no identity)
 */
function findOpenTabForSubject({
	kind,
	metadata,
	openTabs,
}: {
	kind: ChatTabKind;
	metadata: Record<string, unknown> | undefined;
	openTabs: readonly ChatTabRow[];
}): ChatTabRow | undefined {
	const subject = readMetadataSubject(metadata);
	if (!subject) {
		return undefined;
	}
	return openTabs.find(
		(tab) => tab.kind === kind && readMetadataSubject(tab.metadata) === subject,
	);
}

/**
 * Promotes a preview tab to a permanent one by dropping its marker, freeing the
 * slot so the next preview open takes a fresh tab.
 * @param options - The open database and the tab to pin
 * @returns The pinned tab row
 */
function pinOpenTab({
	database,
	tab,
}: {
	database: DatabaseSync;
	tab: ChatTabRow;
}): ChatTabRow | null {
	setChatTabMetadata({
		database,
		id: tab.id,
		metadata: withoutPreviewFlag(tab.metadata),
	});
	return getChatTabById({ database, id: tab.id });
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
	fullTitle,
	metadataPatch,
	title,
}: {
	database: DatabaseSync;
	existing: ChatTabRow;
	fullTitle?: string;
	metadataPatch?: Record<string, unknown>;
	title?: string;
}): void {
	const closed = markClosed({ database, id: existing.id });
	if (!closed) {
		throw new Error(`Failed to close chat tab ${existing.id}.`);
	}
	if (title?.trim()) {
		renameChatTab({
			database,
			fullTitle: fullTitle?.trim() || title.trim(),
			id: existing.id,
			title: title.trim(),
		});
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

/** True when a tab has no attached agent session and should not enter history. */
function isEmptyChatTab(tab: ChatTabRow): boolean {
	return tab.agentSessionId === null;
}

/**
 * True when a closing terminal tab never captured a native harness session id —
 * neither previously persisted on the row nor supplied in the close patch — so it
 * carries no resumable conversation and should be dropped rather than archived.
 * @param tab - The closing terminal tab row
 * @param metadataPatch - The close patch that may stamp a freshly captured id
 * @returns True when no resumable session id exists, false otherwise
 */
function isEmptyTerminalTab(
	tab: ChatTabRow,
	metadataPatch: Record<string, unknown> | undefined,
): boolean {
	return (
		readHarnessSessionId(metadataPatch) === null &&
		readHarnessSessionId(tab.metadata) === null
	);
}

/**
 * Reads the native harness CLI session id off a tab's metadata record. Rows
 * persisted before the metadata key was renamed store it under
 * `agentSessionId` — a name that now belongs to the tab's Ensemblr session FK —
 * so that key is read for backwards compatibility but never written back, and
 * a row self-heals onto `harnessSessionId` the next time it is persisted.
 * @param metadata - Parsed chat-tab metadata record, if any
 * @returns The harness session id, or null when the record carries none
 */
export function readHarnessSessionId(
	metadata: Record<string, unknown> | undefined,
): string | null {
	return (
		readNonEmptyString(metadata?.harnessSessionId) ??
		readNonEmptyString(metadata?.[LEGACY_HARNESS_SESSION_ID_KEY])
	);
}

/**
 * Identity of a non-chat tab's subject. Diff tabs are keyed by their diff scope
 * *and* file path, so the same file viewed at the working tree, in a specific
 * commit, and across the whole branch each get their own tab instead of
 * stealing focus from one another. Turn diffs (no file path) key on the turn id,
 * and comment previews on the comment id.
 */
function readMetadataSubject(
	metadata: Record<string, unknown> | undefined,
): string | null {
	const filePath = readNonEmptyString(metadata?.filePath);
	if (filePath) {
		const scopeKey = serializeWorkspaceGitDiffScope(
			parseWorkspaceGitDiffScope(metadata?.diffScope),
		);
		return `${scopeKey}::${filePath}`;
	}
	const commentId = readCommentPreviewId(metadata);
	if (commentId) {
		return `comment::${commentId}`;
	}
	return readNonEmptyString(metadata?.turnId);
}

/**
 * Reads the comment id a `document` tab previews, which identifies the tab's
 * subject when it carries no file path.
 * @param metadata - Parsed chat-tab metadata record
 * @returns The comment id, or null for document tabs that preview no comment
 */
function readCommentPreviewId(
	metadata: Record<string, unknown> | undefined,
): string | null {
	const commentPreview = metadata?.commentPreview;
	if (!commentPreview || typeof commentPreview !== 'object') {
		return null;
	}
	return readNonEmptyString((commentPreview as { id?: unknown }).id);
}

/**
 * Narrows an untyped metadata value to a usable string.
 * @param value - Value read off a tab's metadata record
 * @returns The string, or null when it is absent, empty, or another type
 */
function readNonEmptyString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Build a summary entry for a tab, or null when the tab has nothing to offer
 * this surface. A closed tab earns its place by being restorable — every kind
 * the close path archives, terminal tabs included, so the history dropdown keeps
 * seeing them. An open one earns it only by being a chat with a transcript to
 * attach; otherwise it is just a tab already sitting in the strip.
 *
 * The summary path/title are populated only when the metadata carries the
 * summary marker (persisted after a successful summary write) *and* the recorded
 * file is still on disk; otherwise they are left empty, marking a closed entry
 * restorable-but-not-attachable so a transcript attach can never fail with
 * ENOENT. The on-disk check uses the path the writer persisted (`summary.path`),
 * not a path recomputed from the workspace root, because a session's cwd can
 * differ from the workspace root (e.g. a worktree) and only the persisted path
 * is authoritative.
 * @param tab - The chat-tab row
 * @returns The summary entry, or null when an open tab has nothing to attach
 */
function toChatTabSummaryEntry(tab: ChatTabRow): ChatTabSummaryEntry | null {
	const summary = readSummaryFromMetadata(tab.metadata);
	const summaryUpdatedAt = summary ? readSummaryMtime(summary.path) : null;
	const attachable = summary !== null && summaryUpdatedAt !== null;
	if (tab.closedAt === null && !(attachable && tab.kind === 'chat')) {
		return null;
	}
	return {
		closedAt: tab.closedAt,
		summaryPath: attachable ? summary.path : '',
		summaryTitle: attachable ? summary.title : null,
		summaryUpdatedAt,
		tab,
	};
}

/**
 * The summary file's last-write time, which doubles as the existence check the
 * entry needs: one `statSync` answers both "is it still there" and "how recently
 * was this chat worked in", and the latter is the only ordering key that ranks a
 * live chat against a closed one.
 * @param summaryPath - Absolute path the summary writer persisted
 * @returns The mtime as an ISO timestamp, or null when the file is gone or unreadable
 */
function readSummaryMtime(summaryPath: string): string | null {
	try {
		return statSync(summaryPath).mtime.toISOString();
	} catch {
		return null;
	}
}

/**
 * Orders summary entries most-recently-written first, sinking the entries with
 * no file at all to the end — they cannot be attached, so they are the least
 * useful rows on the attach-chip surface this ranking answers to.
 *
 * It is not an ordering the history dropdown can use: a terminal tab never has a
 * transcript, so ranking by one would file every terminal below every summarized
 * chat however recently it closed. That consumer re-sorts by `closedAt`.
 * @param left - First entry to compare
 * @param right - Second entry to compare
 * @returns Negative when `left` sorts first, positive when `right` does
 */
function bySummaryRecency(
	left: ChatTabSummaryEntry,
	right: ChatTabSummaryEntry,
): number {
	if (left.summaryUpdatedAt === right.summaryUpdatedAt) {
		return 0;
	}
	if (left.summaryUpdatedAt === null) {
		return 1;
	}
	if (right.summaryUpdatedAt === null) {
		return -1;
	}
	return right.summaryUpdatedAt.localeCompare(left.summaryUpdatedAt);
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
