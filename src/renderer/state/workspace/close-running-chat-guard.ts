/**
 * Pure decision + sequencing logic for the running-chat close guard, kept
 * framework-free so it stays unit-tested independently of React (the
 * {@link useCloseRunningChatGuard} hook is a thin `useState` wrapper over these).
 */

/** A close deferred behind the confirmation dialog: stop the agent, then close. */
export interface PendingClose {
	onClose: () => void;
	onStop: () => Promise<void> | void;
}

/** Input describing one tab-close attempt the guard may need to confirm. */
export interface CloseRunningChatRequest {
	/** True when the target tab's agent is running and closing needs confirming. */
	isRunning: boolean;
	/** Closes the tab. Runs immediately when idle, or after confirm when running. */
	onClose: () => void;
	/** Cancels the running agent; awaited before {@link onClose} on confirm. */
	onStop: () => Promise<void> | void;
}

/** What a close request resolves to: close right away, or defer behind the dialog. */
export type CloseRequestPlan =
	| { kind: 'close-now' }
	| { kind: 'defer'; pending: PendingClose };

/**
 * Decides whether a close request runs immediately (idle target) or must be
 * deferred behind the confirmation dialog (running target). Returning the
 * `PendingClose` rather than acting keeps the branch pure and testable.
 */
export function planClose(request: CloseRunningChatRequest): CloseRequestPlan {
	if (!request.isRunning) {
		return { kind: 'close-now' };
	}
	return {
		kind: 'defer',
		pending: { onClose: request.onClose, onStop: request.onStop },
	};
}

/**
 * Runs a confirmed close: cancel the agent, then close the tab. The stop is
 * best-effort — a failed cancel must not strand the user with a tab they asked
 * to close, so the close always proceeds (the dialog's "closing it will stop the
 * current Pi session" promise is upheld on success; on failure we still honor
 * the close the user explicitly requested).
 */
export async function runConfirmedClose(pending: PendingClose): Promise<void> {
	try {
		await pending.onStop();
	} catch {
		// Swallowed: see contract above — close proceeds regardless.
	} finally {
		pending.onClose();
	}
}
