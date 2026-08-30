import {
	resolveWindowChrome,
	type WindowChromeSnapshot,
} from '@/shared/window-chrome';

const INSET_START_PROPERTY = '--ensemblr-window-chrome-inset-start';
const INSET_TOP_PROPERTY = '--ensemblr-window-chrome-inset-top';

/**
 * Marks the document while Ensemblr draws the window controls itself, so the
 * surfaces that size themselves to the viewport give the title bar its strip
 * back without every one of them knowing about it.
 */
const OWN_CONTROLS_CLASS = 'app-window-controls';

/**
 * One CSS `rem` in pixels, for the surfaces that weigh the chrome insets — which
 * are expressed in `rem` — against a measured rectangle. The app never overrides
 * the root font size.
 */
const REM_IN_PX = 16;

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
 * The same insets in pixels, for the floating surfaces that place themselves
 * against the viewport rather than inside the flow: a panel clamping its own
 * drag has a measured rectangle to compare against, not a CSS length.
 * @returns The leading and top insets, in pixels.
 */
export function readWindowChromeInsetsPx(): { start: number; top: number } {
	const { insets } = readWindowChrome();

	return { start: insets.start * REM_IN_PX, top: insets.top * REM_IN_PX };
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
	root.style.setProperty(INSET_TOP_PROPERTY, `${chrome.insets.top}rem`);
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
