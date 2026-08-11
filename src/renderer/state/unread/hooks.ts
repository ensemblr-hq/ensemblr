import { useAtomValue, useSetAtom } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { useMemo } from 'react';

import { type UnreadChatEntry, unreadChatEntriesAtom } from './atoms';
import {
	clearChatUnread,
	clearWorkspaceUnread,
	collectWorkspaceUnreadKeys,
	countWorkspaceUnread,
	markChatUnread,
	retainKnownWorkspaces,
	selectLastUnread,
	type UnreadChatRef,
} from './entries';

/** Stable setters over the unread chat list, none of which subscribe to it. */
export interface UnreadChatActions {
	clearChat: (ref: UnreadChatRef) => void;
	clearWorkspace: (workspaceId: string) => void;
	markChat: (entry: UnreadChatEntry) => void;
	retainWorkspaces: (knownWorkspaceIds: ReadonlySet<string>) => void;
}

/**
 * Exposes the unread-list setters without subscribing, so a component that only
 * writes marks never re-renders when someone else's chat goes unread.
 * @returns The {@link UnreadChatActions} setter bundle.
 */
export function useUnreadChatActions(): UnreadChatActions {
	const setEntries = useSetAtom(unreadChatEntriesAtom);

	return useMemo(
		() => ({
			clearChat: (ref) =>
				setEntries((entries) => clearChatUnread(entries, ref)),
			clearWorkspace: (workspaceId) =>
				setEntries((entries) => clearWorkspaceUnread(entries, workspaceId)),
			markChat: (entry) =>
				setEntries((entries) => markChatUnread(entries, entry)),
			retainWorkspaces: (knownWorkspaceIds) =>
				setEntries((entries) =>
					retainKnownWorkspaces(entries, knownWorkspaceIds),
				),
		}),
		[setEntries],
	);
}

/**
 * Reads how many chats are unread in one workspace, scoped so only that row
 * re-renders when its own count moves.
 * @param workspaceId - Workspace whose count to read.
 * @returns The number of unread chats it holds.
 */
export function useWorkspaceUnreadCount(workspaceId: string): number {
	const countAtom = useMemo(
		() =>
			selectAtom(unreadChatEntriesAtom, (entries) =>
				countWorkspaceUnread(entries, workspaceId),
			),
		[workspaceId],
	);
	return useAtomValue(countAtom);
}

/** Whether two key sets hold the same ids, so an unrelated mark is not a change. */
function areKeySetsEqual(
	left: ReadonlySet<string>,
	right: ReadonlySet<string>,
): boolean {
	if (left.size !== right.size) {
		return false;
	}
	for (const key of left) {
		if (!right.has(key)) {
			return false;
		}
	}
	return true;
}

/**
 * Reads the ids the workspace's unread chats can be matched by, for the tab
 * strip. Compared by membership rather than identity, since the selector builds
 * a fresh set every time the list changes anywhere.
 * @param workspaceId - Workspace whose tabs are on screen.
 * @returns Tab ids and session ids of that workspace's unread chats.
 */
export function useWorkspaceUnreadKeys(
	workspaceId: string,
): ReadonlySet<string> {
	const keysAtom = useMemo(
		() =>
			selectAtom(
				unreadChatEntriesAtom,
				(entries) => collectWorkspaceUnreadKeys(entries, workspaceId),
				areKeySetsEqual,
			),
		[workspaceId],
	);
	return useAtomValue(keysAtom);
}

/**
 * Reads the most recently marked unread chat anywhere in the app, backing the
 * composer's jump control and deciding whether it renders at all.
 * @returns The newest unread chat, or null when nothing is unread.
 */
export function useLastUnreadChat(): UnreadChatEntry | null {
	const lastAtom = useMemo(
		() => selectAtom(unreadChatEntriesAtom, selectLastUnread),
		[],
	);
	return useAtomValue(lastAtom);
}
