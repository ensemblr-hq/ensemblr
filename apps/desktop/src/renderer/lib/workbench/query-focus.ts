import { focusManager } from '@tanstack/react-query';

/**
 * Teaches TanStack Query that an Electron window the user has clicked away from
 * is not focused, so its polling queries stop firing until they come back.
 *
 * `QueryObserver` runs a `refetchInterval` tick only when
 * `refetchIntervalInBackground || focusManager.isFocused()`, and the default
 * `isFocused` is `document.visibilityState !== 'hidden'`. In a browser tab those
 * agree; in a desktop window they do not. A background Ensemblr window is still
 * `visible` by that definition, so every interval kept running against a window
 * nobody is looking at — the workspace-overview fan-out is `git status` per
 * workspace, which is the expensive one.
 *
 * The window's own `focus`/`blur` events are the signal, with
 * `visibilitychange` kept so a minimized or occluded window still counts as
 * away. Refocusing resumes the intervals rather than refetching immediately:
 * `refetchOnWindowFocus` is off globally (`api/query-client.ts`), which is what
 * keeps coming back to the app from firing every query at once.
 * @returns Nothing; the listener lives for the window's lifetime
 */
export function syncQueryFocusWithWindow(): void {
	focusManager.setEventListener((handleFocus) => {
		if (typeof window === 'undefined' || !window.addEventListener) {
			return;
		}

		const report = () =>
			handleFocus(
				globalThis.document?.visibilityState !== 'hidden' &&
					globalThis.document.hasFocus(),
			);

		window.addEventListener('focus', report, false);
		window.addEventListener('blur', report, false);
		window.addEventListener('visibilitychange', report, false);
		report();

		return () => {
			window.removeEventListener('focus', report);
			window.removeEventListener('blur', report);
			window.removeEventListener('visibilitychange', report);
		};
	});
}
