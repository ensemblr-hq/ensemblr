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

/**
 * Renderer → main report of whether the Concierge panel is on screen, which is
 * the Concierge's equivalent of {@link ActiveChatContext}: it is the one fact
 * that decides whether a finished Concierge turn is worth an OS notification.
 *
 * A boolean rather than an identity, because there is one Concierge and it is
 * either in front of the user or it is not. The panel floats above whatever
 * route is open, so this is orthogonal to the active chat rather than part of
 * it.
 */
export interface ConciergeVisibilityReport {
	visible: boolean;
}

/**
 * Main → renderer signal that a chat finished a turn the user should know
 * about, broadcast to every window. The in-app unread mark hangs off this
 * rather than off the raw session-event stream, so the two surfaces that tell a
 * user a chat wants them — the desktop notification and the unread mark — share
 * one decision instead of re-deriving it and disagreeing.
 *
 * What it already excludes: a sub-agent's chat, which is its orchestrator's
 * business, and the `idle` that is only the tail of a stop the user asked for.
 * Neither fact reaches the renderer any other way. What it does *not* apply is
 * the desktop-notification setting or window focus — those gate the OS
 * notification alone, and an unread mark that vanished with the setting would
 * leave the app with no way to say a background chat is done.
 *
 * `chatTabId` is null when the session's tab could not be resolved, exactly as
 * in {@link FocusChatBroadcast}.
 */
export interface ChatTurnFinishedBroadcast {
	agentSessionId: string;
	chatTabId: string | null;
	/** ISO timestamp of the event that ended the turn, for display ordering. */
	finishedAt: string;
	workspaceId: string;
}
