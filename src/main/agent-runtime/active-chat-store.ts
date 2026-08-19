import type { ActiveChatContext } from '../../shared/ipc/contracts/notifications.ts';

/**
 * The chat a silence check is about, named by both of its ids. Either one
 * identifying it is what keeps a stale id on one side from making the chat the
 * user is reading look like a background one.
 */
export interface OnScreenChatRef {
	agentSessionId: string;
	chatTabId: string | null;
	workspaceId: string;
}

/**
 * Holds the chat the renderer last reported as being on screen, so the desktop
 * notifier can suppress a notification for that one chat rather than for the
 * whole app.
 *
 * Main cannot see renderer routing state and the renderer cannot post an OS
 * notification, so this is the one fact that has to cross the boundary. It is
 * in-memory: a fresh run has no chat on screen until a route resolves, which is
 * the safe default — an unknown active chat notifies.
 */
export class ActiveChatStore {
	private context: ActiveChatContext | null = null;

	/**
	 * Records what the renderer just reported, or null when no chat is open.
	 * @param next - The chat on screen, or null
	 */
	apply(next: ActiveChatContext | null): void {
		this.context = next;
	}

	/**
	 * Whether a chat is the one currently on screen, by either of its ids.
	 *
	 * The renderer reports the session id its tab list has resolved, while a turn
	 * arrives carrying the one the runtime is actually running, so the two
	 * disagree whenever the tab list is behind — first paint of a workspace, a tab
	 * an agent just opened, a chat whose runtime was resumed. Matching on the tab
	 * id as well is what stops that window notifying the user about the chat in
	 * front of them.
	 * @param chat - The chat being checked, by workspace, session, and tab
	 * @returns True when the user is looking at exactly this chat
	 */
	isOnScreen(chat: OnScreenChatRef): boolean {
		if (this.context?.workspaceId !== chat.workspaceId) {
			return false;
		}
		const matchesSession = this.context.agentSessionId === chat.agentSessionId;
		const matchesTab =
			chat.chatTabId !== null && this.context.chatTabId === chat.chatTabId;
		return matchesSession || matchesTab;
	}
}
