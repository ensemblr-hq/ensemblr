import type { ActiveChatContext } from '../../shared/ipc/contracts/notifications.ts';

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
	 * Whether a given session is the chat currently on screen.
	 * @param workspaceId - Workspace the session belongs to
	 * @param agentSessionId - The session being checked
	 * @returns True when the user is looking at exactly this chat
	 */
	isOnScreen(workspaceId: string, agentSessionId: string): boolean {
		return (
			this.context?.workspaceId === workspaceId &&
			this.context.agentSessionId === agentSessionId
		);
	}
}
