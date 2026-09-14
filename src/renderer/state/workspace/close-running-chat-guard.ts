/**
 * Pure decision + sequencing logic for the running-chat close guard, kept
 * framework-free so it stays unit-tested independently of React (the
 * {@link useCloseRunningChatGuard} hook is a thin `useState` wrapper over these).
 */

/** A close deferred behind the confirmation dialog: stop the agent, then close. */
export interface PendingClose {
	/**
	 * How many background tasks the chat still has running. Carried alongside
	 * {@link isRunning} rather than instead of it: the two are independent, and
	 * the case where both hold — a model that backgrounded a shell and is still
	 * talking — is the one where closing costs the most, so the dialog names both
	 * rather than picking whichever came first.
	 */
	backgroundTaskCount: number;
	/** True when the chat's own turn is in flight, so confirming cancels it. */
	isRunning: boolean;
	onClose: () => void;
	onStop: () => Promise<void> | void;
}

/** Input describing one tab-close attempt the guard may need to confirm. */
export interface CloseRunningChatRequest {
	/**
	 * Background tasks the target chat still has running. Counted separately from
	 * {@link isRunning} because a background task outlives the turn that started
	 * it: the chat reads as idle while the work continues, which is exactly when
	 * a close would take it away unannounced.
	 */
	backgroundTaskCount: number;
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
 * Decides whether a close request runs immediately (idle target with nothing in
 * the background) or must be deferred behind the confirmation dialog. Returning
 * the `PendingClose` rather than acting keeps the branch pure and testable.
 */
export function planClose(request: CloseRunningChatRequest): CloseRequestPlan {
	if (!request.isRunning && request.backgroundTaskCount === 0) {
		return { kind: 'close-now' };
	}
	return {
		kind: 'defer',
		pending: {
			backgroundTaskCount: request.backgroundTaskCount,
			isRunning: request.isRunning,
			onClose: request.onClose,
			onStop: request.onStop,
		},
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
