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
type CloseRequestPlan =
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
 * Runs a confirmed close: request an agent stop, then close the tab immediately.
 * The stop is best-effort and intentionally non-blocking so a hung cancel cannot
 * strand the user with a tab they explicitly chose to force-close.
 */
export function runConfirmedClose(pending: PendingClose): Promise<void> {
	try {
		void Promise.resolve(pending.onStop()).catch(() => undefined);
	} catch {
		// onStop threw synchronously — the stop is best-effort, so the close
		// the user explicitly requested still proceeds below.
	}
	pending.onClose();
	return Promise.resolve();
}
