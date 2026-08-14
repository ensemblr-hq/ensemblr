/**
 * Renderer → main report of the chat currently on screen.
 *
 * The desktop notifier suppresses a notification only for the chat the user is
 * actually looking at, and that fact lives in renderer routing state. Null means
 * no chat is open — the welcome screen, a settings route, or a window that has
 * navigated away from a workspace.
 */
export interface ActiveChatContext {
	agentSessionId: string | null;
	chatTabId: string;
	workspaceId: string;
}

/**
 * Main → renderer request to open the chat behind a clicked desktop
 * notification, broadcast to every window after the app has been raised.
 *
 * `chatTabId` is null when the session's tab could not be resolved in main; the
 * renderer then looks it up itself and falls back to the workspace's preferred
 * chat. Unlike an agent-control focus request this may name a workspace the
 * window is not showing, and crossing into it is the point.
 */
export interface FocusChatBroadcast {
	agentSessionId: string;
	chatTabId: string | null;
	workspaceId: string;
}
