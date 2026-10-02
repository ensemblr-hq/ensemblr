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
 * Marks the document while the platform insets its own window controls into the
 * content, as macOS does with the traffic lights. There the app's toolbars are
 * the window's drag surface, so the `-webkit-app-region: drag` rule keyed on
 * this class turns them into one — a surface Linux keeps as plain content.
 */
const INSET_CONTROLS_CLASS = 'inset-window-controls';

/**
 * One CSS `rem` in pixels, for the surfaces that weigh the chrome insets — which
 * are expressed in `rem` — against a measured rectangle. The app never overrides
 * the root font size.
 */
const REM_IN_PX = 16;

/**
 * The chrome `applyWindowChrome` last wrote to the document, replaced whole on
 * each write rather than edited.
 *
 * Most of the chrome is fixed when the window is constructed, but full screen
 * is not: macOS slides its traffic lights off the window there and main pushes
 * a fresh snapshot. The preload bootstrap value is frozen for the page's
 * lifetime, so a reader that trusted it would keep reporting a gutter for
 * traffic lights that are no longer on the window.
 *
 * Lives as long as the module instance, which under Vitest means one test file:
 * a file that applies chrome and then expects the bootstrap value back has to
 * apply the one it expects rather than assume a clean slate.
 */
let appliedChrome: WindowChromeSnapshot | null = null;

/**
 * Reads the chrome the window currently wears — whatever `applyWindowChrome`
 * last wrote, which main keeps current across full-screen transitions.
 *
 * Falls back to the preload bootstrap snapshot until the first write, and to
 * resolving from the platform when that snapshot is missing too — a dev reload
 * before the bridge is up, or a test harness — which errs toward the macOS
 * answer on macOS and no insets anywhere else.
 * @returns The window chrome as it stands.
 */
export function readWindowChrome(): WindowChromeSnapshot {
	if (appliedChrome) {
		return appliedChrome;
	}

	const snapshot =
		typeof window === 'undefined'
			? undefined
			: window.ensemblrInitialShellSnapshot?.windowChrome;

	return snapshot ?? resolveWindowChrome(detectPlatform(), 'system');
}

/**
 * A snapshot's insets in pixels, for the surfaces that weigh them against a
 * measured rectangle rather than against a CSS length: a maximized panel
 * deciding whether it covers the corner the traffic lights sit in has a
 * `DOMRect`, not a `rem`.
 *
 * Takes the snapshot rather than reading one, so a component that subscribes to
 * `windowChromeAtom` converts the value it re-rendered on instead of reaching
 * for a second source that may have moved since.
 * @param chrome - The chrome to measure.
 * @returns The leading and top insets, in pixels.
 */
export function windowChromeInsetsPx(chrome: WindowChromeSnapshot): {
	start: number;
	top: number;
} {
	return {
		start: chrome.insets.start * REM_IN_PX,
		top: chrome.insets.top * REM_IN_PX,
	};
}

/**
 * The same insets for the chrome the window currently wears, for callers
 * outside React that have nothing to subscribe with. Tracks full screen along
 * with {@link readWindowChrome}, so the leading inset falls to zero at the same
 * moment the custom property does.
 *
 * `start` is the one that moves, and this is a plain read that never tells React
 * so. A component branching on it needs {@link windowChromeInsetsPx} over
 * `windowChromeAtom`; `top` is construct-time, so a drag clamp may read it here.
 * @returns The leading and top insets, in pixels.
 */
export function readWindowChromeInsetsPx(): { start: number; top: number } {
	return windowChromeInsetsPx(readWindowChrome());
}

/**
 * Writes the resolved insets onto the document element as CSS custom
 * properties, before React's first paint, so no toolbar renders at the wrong
 * offset and then jumps. The snapshot it writes becomes the one
 * {@link readWindowChrome} reports, so the properties and the readers cannot
 * describe different windows.
 * @param chrome - The chrome the window wears from now on.
 */
export function applyWindowChrome(chrome: WindowChromeSnapshot): void {
	if (typeof document === 'undefined') {
		return;
	}

	appliedChrome = chrome;
	const root = document.documentElement;
	root.style.setProperty(INSET_START_PROPERTY, `${chrome.insets.start}rem`);
	root.style.setProperty(INSET_TOP_PROPERTY, `${chrome.insets.top}rem`);
	root.classList.toggle(OWN_CONTROLS_CLASS, chrome.drawsOwnControls);
	root.classList.toggle(
		INSET_CONTROLS_CLASS,
		chrome.controls === 'system-inset',
	);
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
