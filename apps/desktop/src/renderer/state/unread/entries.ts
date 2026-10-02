import { MAX_UNREAD_ENTRIES, type UnreadChatEntry } from './atoms';

/**
 * Names the chat a mark or a clear applies to. Either id alone is enough: a mark
 * made while its workspace was closed carries only the session id, while a tab
 * the user opens is known by its tab id before its session has been resolved.
 */
export interface UnreadChatRef {
	agentSessionId?: string | null;
	chatTabId?: string | null;
	workspaceId: string;
}

/** Whether an entry stands for the chat a reference names, by either id. */
function matchesChat(entry: UnreadChatEntry, ref: UnreadChatRef): boolean {
	if (entry.workspaceId !== ref.workspaceId) {
		return false;
	}
	const matchesTab = ref.chatTabId != null && entry.chatTabId === ref.chatTabId;
	const matchesSession =
		ref.agentSessionId != null && entry.agentSessionId === ref.agentSessionId;
	return matchesTab || matchesSession;
}

/**
 * Records a chat as unread and moves it to the end, so the tail is always the
 * most recent thing to read. A mark already held for the same chat is replaced
 * rather than duplicated, keeping whichever tab id is known, and the list is
 * trimmed from the front past {@link MAX_UNREAD_ENTRIES}.
 * @param entries - Current unread list.
 * @param entry - The chat that just produced something to read.
 * @returns The next list.
 */
export function markChatUnread(
	entries: readonly UnreadChatEntry[],
	entry: UnreadChatEntry,
): readonly UnreadChatEntry[] {
	const existing = entries.find((candidate) => matchesChat(candidate, entry));
	const merged: UnreadChatEntry = {
		...entry,
		chatTabId: entry.chatTabId ?? existing?.chatTabId ?? null,
	};
	const others = entries.filter((candidate) => candidate !== existing);
	return [...others, merged].slice(-MAX_UNREAD_ENTRIES);
}

/**
 * Drops every mark held for one chat. Returns the list unchanged when it held
 * none, so an unrelated navigation does not churn the persisted value.
 * @param entries - Current unread list.
 * @param ref - The chat that was just read.
 * @returns The next list.
 */
export function clearChatUnread(
	entries: readonly UnreadChatEntry[],
	ref: UnreadChatRef,
): readonly UnreadChatEntry[] {
	const remaining = entries.filter((entry) => !matchesChat(entry, ref));
	return remaining.length === entries.length ? entries : remaining;
}

/**
 * Drops every mark held for a workspace, backing the sidebar's manual
 * "mark as read" so it clears the tab markers along with the row.
 * @param entries - Current unread list.
 * @param workspaceId - Workspace being marked read.
 * @returns The next list.
 */
export function clearWorkspaceUnread(
	entries: readonly UnreadChatEntry[],
	workspaceId: string,
): readonly UnreadChatEntry[] {
	const remaining = entries.filter(
		(entry) => entry.workspaceId !== workspaceId,
	);
	return remaining.length === entries.length ? entries : remaining;
}

/**
 * Drops marks whose workspace no longer exists, so an archived or deleted
 * workspace cannot leave a mark nothing on screen can ever clear. Returns the
 * list unchanged when every mark is still live.
 * @param entries - Current unread list.
 * @param knownWorkspaceIds - Ids of the workspaces the shell currently knows.
 * @returns The next list.
 */
export function retainKnownWorkspaces(
	entries: readonly UnreadChatEntry[],
	knownWorkspaceIds: ReadonlySet<string>,
): readonly UnreadChatEntry[] {
	const remaining = entries.filter((entry) =>
		knownWorkspaceIds.has(entry.workspaceId),
	);
	return remaining.length === entries.length ? entries : remaining;
}

/**
 * Whether one chat still holds a mark. Backs the self-heal that drops a mark for
 * the chat on screen, which cannot know up front which of the two ids the mark
 * was recorded under — this is how it reaches the same either-id matching a
 * clear uses without that rule leaving this module.
 * @param entries - Current unread list.
 * @param ref - The chat to look for.
 * @returns True when a mark is held for that chat.
 */
export function isChatUnread(
	entries: readonly UnreadChatEntry[],
	ref: UnreadChatRef,
): boolean {
	return entries.some((entry) => matchesChat(entry, ref));
}

/**
 * The most recently marked chat still unread, wherever it lives.
 * @param entries - Current unread list.
 * @returns The newest entry, or null when nothing is unread.
 */
export function selectLastUnread(
	entries: readonly UnreadChatEntry[],
): UnreadChatEntry | null {
	return entries.at(-1) ?? null;
}

/**
 * How many chats are unread in one workspace, for the sidebar row's count.
 * @param entries - Current unread list.
 * @param workspaceId - Workspace to count.
 * @returns The number of unread chats it holds.
 */
export function countWorkspaceUnread(
	entries: readonly UnreadChatEntry[],
	workspaceId: string,
): number {
	return entries.filter((entry) => entry.workspaceId === workspaceId).length;
}

/**
 * Every id a workspace's unread chats can be recognised by — tab ids and session
 * ids together, because a mark made while the workspace was closed carries only
 * the latter. The tab strip matches a tab against this rather than resolving the
 * missing ids up front.
 * @param entries - Current unread list.
 * @param workspaceId - Workspace whose keys to collect.
 * @returns The set of matching ids.
 */
export function collectWorkspaceUnreadKeys(
	entries: readonly UnreadChatEntry[],
	workspaceId: string,
): ReadonlySet<string> {
	const keys = new Set<string>();
	for (const entry of entries) {
		if (entry.workspaceId !== workspaceId) {
			continue;
		}
		keys.add(entry.agentSessionId);
		if (entry.chatTabId) {
			keys.add(entry.chatTabId);
		}
	}
	return keys;
}
