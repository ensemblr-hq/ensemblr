/**
 * Public surface of per-chat unread state: the persisted list, the pure
 * reducers over it, and the scoped read hooks the sidebar, the tab strip, and
 * the composer's jump control read it through.
 */
export {
	type ActiveChatIdentity,
	activeChatIdentityAtom,
	usePublishActiveChat,
} from './active-chat';
export {
	MAX_UNREAD_ENTRIES,
	type UnreadChatEntry,
	unreadChatEntriesAtom,
} from './atoms';
export {
	clearChatUnread,
	clearWorkspaceUnread,
	collectWorkspaceUnreadKeys,
	countWorkspaceUnread,
	markChatUnread,
	retainKnownWorkspaces,
	selectLastUnread,
	type UnreadChatRef,
} from './entries';
export {
	type UnreadChatActions,
	useLastUnreadChat,
	useUnreadChatActions,
	useWorkspaceUnreadCount,
	useWorkspaceUnreadKeys,
} from './hooks';
