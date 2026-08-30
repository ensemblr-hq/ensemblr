import {
	resolveWindowChrome,
	type WindowChromeSnapshot,
} from '@/shared/window-chrome';

const INSET_START_PROPERTY = '--ensemblr-window-chrome-inset-start';
const INSET_END_PROPERTY = '--ensemblr-window-chrome-inset-end';

/**
 * Marks the document while Ensemblr draws the window controls itself, so CSS
 * can reserve the trailing strip without every toolbar knowing about it.
 */
const OWN_CONTROLS_CLASS = 'app-window-controls';

/**
 * Reads the chrome the main process actually constructed the window with. Falls
 * back to resolving it from the platform when the preload snapshot is missing —
 * a dev reload before the bridge is up, or a test harness — which errs toward
 * the macOS answer on macOS and no insets anywhere else.
 * @returns The window chrome for this session.
 */
export function readWindowChrome(): WindowChromeSnapshot {
	const snapshot =
		typeof window === 'undefined'
			? undefined
			: window.ensemblrInitialShellSnapshot?.windowChrome;

	return snapshot ?? resolveWindowChrome(detectPlatform(), 'system');
}

/**
 * Writes the resolved insets onto the document element as CSS custom
 * properties, before React's first paint, so no toolbar renders at the wrong
 * offset and then jumps.
 * @param chrome - The chrome the window was constructed with.
 */
export function applyWindowChrome(chrome: WindowChromeSnapshot): void {
	if (typeof document === 'undefined') {
		return;
	}

	const root = document.documentElement;
	root.style.setProperty(INSET_START_PROPERTY, `${chrome.insets.start}rem`);
	root.style.setProperty(INSET_END_PROPERTY, `${chrome.insets.end}rem`);
	root.classList.toggle(OWN_CONTROLS_CLASS, chrome.drawsOwnControls);
}

/**
 * Names the platform from what the renderer can see, which is the user-agent
 * rather than `process` — the renderer runs context-isolated with no Node.
 * @returns A `process.platform`-shaped string.
 */
export function detectPlatform(): NodeJS.Platform | string {
	if (typeof navigator === 'undefined') {
		return 'unknown';
	}

	const descriptor = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;

	if (/Mac/i.test(descriptor)) {
		return 'darwin';
	}
	if (/Linux|X11/i.test(descriptor)) {
		return 'linux';
	}
	if (/Win/i.test(descriptor)) {
		return 'win32';
	}
	return 'unknown';
}
