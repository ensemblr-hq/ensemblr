import { useSyncExternalStore } from 'react';

/** Which of the app's two root theme classes is currently applied. */
export type ColorMode = 'dark' | 'light';

const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/**
 * Subscribes to both signals that can flip the mode: `useThemeEffect` rewriting
 * the root class, and the OS scheme changing under a `system` setting.
 * @param onChange - Callback React uses to schedule a re-read
 * @returns An unsubscribe function
 */
function subscribeToColorMode(onChange: () => void): () => void {
	const observer = new MutationObserver(onChange);
	observer.observe(document.documentElement, { attributeFilter: ['class'] });
	const media = window.matchMedia(DARK_SCHEME_QUERY);
	media.addEventListener('change', onChange);
	return () => {
		observer.disconnect();
		media.removeEventListener('change', onChange);
	};
}

/**
 * Reads the mode off the root class `useThemeEffect` applies, falling back to
 * the OS scheme for the first paint before that effect has run.
 * @returns The mode the app is painting in
 */
function readColorMode(): ColorMode {
	const root = document.documentElement;
	if (root.classList.contains('dark')) return 'dark';
	if (root.classList.contains('light')) return 'light';
	return window.matchMedia(DARK_SCHEME_QUERY).matches ? 'dark' : 'light';
}

/**
 * Stands in for a render with no document to read — `renderToString` in tests
 * and prerendering. The client re-reads the real class on hydration.
 * @returns The app's default mode
 */
function readDefaultColorMode(): ColorMode {
	return 'dark';
}

/**
 * The colour mode the app is actually painting in.
 *
 * Read from the root theme class rather than recomputed from the theme setting,
 * so anything that pins the class — `useThemeEffect`, the playground shell —
 * moves the syntax theme in lockstep with the surface it sits on.
 * @returns The active colour mode
 */
export function useColorMode(): ColorMode {
	return useSyncExternalStore(
		subscribeToColorMode,
		readColorMode,
		readDefaultColorMode,
	);
}
