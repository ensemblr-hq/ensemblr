/**
 * The state machine behind app quit: which gesture asks the user, which one is
 * already answered, and which one is past the point of asking.
 *
 * Two gestures reach it. `before-quit` covers ⌘Q, the app menu and the Dock. A
 * window `close` covers the traffic-light button, which matters because this app
 * quits once the last window closes — by the time `window-all-closed` fires the
 * window is already destroyed, so a guard that only watched `before-quit` would
 * have nothing left to host its dialog and would wave the quit through.
 *
 * Both gestures answer the same question, so a confirmation from either satisfies
 * the other: the close path replays the close, that cascades into a quit, and the
 * quit path finds the answer already given rather than asking twice. This assumes
 * the single-window shell the app actually ships (`activate` and `second-instance`
 * both reuse the one window), where a confirmed close always cascades to a quit.
 *
 * Every phase transition is synchronous with the gesture that caused it, so the
 * Electron handlers stay one-liners: they ask whether to `preventDefault()` and
 * do nothing else.
 */

/** How far along the quit is: nobody asked, asking, answered, tearing down. */
type QuitPhase = 'confirmed' | 'confirming' | 'idle' | 'shutting-down';

/** Options for {@link createQuitCoordinator}. */
export interface QuitCoordinatorOptions {
	/** Tears the agent children down, then re-issues the quit itself. */
	beginAgentShutdown: () => void;
	/** Asks the user whether the quit may interrupt the agents still working. */
	confirmQuit: () => Promise<boolean>;
	/** Re-issues the quit once the user has let one through. */
	quit: () => void;
}

/** Public surface of the quit coordinator. */
export interface QuitCoordinator {
	/** Handles `before-quit`; true when the caller must `preventDefault()`. */
	handleBeforeQuit: () => boolean;
	/** Handles a window `close`; true when the caller must `preventDefault()`. */
	handleWindowClose: (replayClose: () => void) => boolean;
}

/**
 * Builds the quit coordinator.
 * @param options - The confirmation, the agent teardown, and the quit re-issue.
 * @returns A coordinator both Electron quit handlers delegate to.
 */
export function createQuitCoordinator(
	options: QuitCoordinatorOptions,
): QuitCoordinator {
	let phase: QuitPhase = 'idle';

	/**
	 * Puts the quit to the user, then replays the gesture that asked. A rejected
	 * confirmation fails open, matching the guard's own stance on a missing
	 * window: a dialog that cannot be drawn must not be able to strand the app in
	 * `confirming`, where every later quit gesture would be swallowed and only
	 * Force Quit would remain.
	 * @param replayGesture - Re-issues the gesture once the user accepts.
	 */
	const ask = (replayGesture: () => void): void => {
		phase = 'confirming';
		void (async () => {
			let confirmed = true;
			try {
				confirmed = await options.confirmQuit();
			} catch (error) {
				console.warn(
					'[quit] the confirmation failed; letting the quit through',
					error,
				);
			}
			phase = confirmed ? 'confirmed' : 'idle';
			if (confirmed) {
				replayGesture();
			}
		})();
	};

	const handleBeforeQuit = (): boolean => {
		if (phase === 'shutting-down') {
			return false;
		}
		if (phase === 'confirming') {
			return true;
		}
		if (phase === 'confirmed') {
			phase = 'shutting-down';
			options.beginAgentShutdown();
			return true;
		}
		ask(options.quit);
		return true;
	};

	const handleWindowClose = (replayClose: () => void): boolean => {
		if (phase === 'confirmed' || phase === 'shutting-down') {
			return false;
		}
		if (phase === 'confirming') {
			return true;
		}
		ask(replayClose);
		return true;
	};

	return { handleBeforeQuit, handleWindowClose };
}
