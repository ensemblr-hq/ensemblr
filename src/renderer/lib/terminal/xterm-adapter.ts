import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';

import '@xterm/xterm/css/xterm.css';

import type { TerminalRendererAdapter } from '@/renderer/types/terminal';

/** Options for {@link createXtermAdapter}. */
interface CreateXtermAdapterOptions {
	/** CSS font-family stack for the terminal glyphs. */
	fontFamily?: string;
	fontSize?: number;
	/**
	 * When true the surface never accepts keyboard input: stdin is disabled and
	 * the cursor is hidden. Used by the read-only Setup/Run output panels.
	 */
	readOnly?: boolean;
	scrollback?: number;
}

/** Fallback monospace stack used when no user terminal font is set. */
export const DEFAULT_FONT_FAMILY =
	'"JetBrains Mono Variable", ui-monospace, monospace';
const DEFAULT_FONT_SIZE = 12;
const DEFAULT_SCROLLBACK = 10_000;

/**
 * Builds the xterm.js-backed terminal adapter with fit, clickable links, and
 * the workspace monospace font.
 * @param options - Typography, scrollback, and read-only overrides.
 * @returns A fresh {@link TerminalRendererAdapter}.
 */
export function createXtermAdapter({
	fontFamily = DEFAULT_FONT_FAMILY,
	fontSize = DEFAULT_FONT_SIZE,
	readOnly = false,
	scrollback = DEFAULT_SCROLLBACK,
}: CreateXtermAdapterOptions = {}): TerminalRendererAdapter {
	const terminal = new Terminal({
		allowTransparency: true,
		convertEol: false,
		cursorBlink: !readOnly,
		cursorInactiveStyle: readOnly ? 'none' : 'outline',
		cursorStyle: readOnly ? 'underline' : 'block',
		disableStdin: readOnly,
		fontFamily,
		fontSize,
		scrollback,
		theme: readThemeFromDocument(),
	});
	const fitAddon = new FitAddon();
	terminal.loadAddon(fitAddon);
	terminal.loadAddon(new WebLinksAddon());
	const themeObserver = observeDocumentTheme(() => {
		terminal.options.theme = readThemeFromDocument();
	});

	return {
		attach: (element) => {
			terminal.open(element);
		},
		clear: () => terminal.clear(),
		dispose: () => {
			themeObserver?.disconnect();
			terminal.dispose();
		},
		fit: () => {
			try {
				fitAddon.fit();
			} catch {
				return null;
			}

			return { cols: terminal.cols, rows: terminal.rows };
		},
		focus: () => terminal.focus(),
		onData: (listener) => {
			const subscription = terminal.onData(listener);

			return () => subscription.dispose();
		},
		setFont: ({ fontFamily: nextFamily, fontSize: nextSize }) => {
			if (nextFamily !== undefined) {
				terminal.options.fontFamily = nextFamily;
			}
			if (nextSize !== undefined) {
				terminal.options.fontSize = nextSize;
			}
		},
		write: (data) => terminal.write(data),
	};
}

/**
 * Watches `<html>` attribute changes (class/data-theme/style) so already
 * mounted terminals re-derive their colors when the app theme switches at
 * runtime instead of keeping the palette they were created with.
 * @param onThemeChange - Invoked after any root attribute mutation.
 * @returns The observer, or null outside a DOM (tests).
 */
function observeDocumentTheme(
	onThemeChange: () => void,
): MutationObserver | null {
	if (
		typeof document === 'undefined' ||
		typeof MutationObserver === 'undefined'
	) {
		return null;
	}

	const observer = new MutationObserver(onThemeChange);
	observer.observe(document.documentElement, {
		attributeFilter: ['class', 'data-theme', 'style'],
		attributes: true,
	});

	return observer;
}

/**
 * Derives the xterm theme from the app's CSS design tokens so the terminal
 * follows the active Ensemblr theme: the dock terminal surface shares the
 * sidebar background. Falls back to a transparent background with inherited
 * colors when tokens are unavailable (tests).
 */
function readThemeFromDocument(): {
	background: string;
	cursor?: string;
	foreground?: string;
} {
	if (typeof document === 'undefined') {
		return { background: '#00000000' };
	}

	const styles = getComputedStyle(document.documentElement);
	const background = resolveCssColor(
		styles.getPropertyValue('--sidebar').trim(),
	);
	const foreground = resolveCssColor(
		styles.getPropertyValue('--foreground').trim(),
	);
	const cursor = resolveCssColor(styles.getPropertyValue('--primary').trim());

	return {
		background: background ?? '#00000000',
		...(foreground ? { foreground } : {}),
		...(cursor ? { cursor } : {}),
	};
}

/**
 * Normalizes any CSS color into an opaque `#rrggbb` for xterm by rasterizing
 * it through a 1×1 canvas. Two xterm parser constraints force this: it cannot
 * read modern syntaxes via string round-trips (Chrome serializes oklch back as
 * oklch, not legacy rgba), and its own canvas fallback throws on any alpha
 * below 1 — the design tokens (e.g. `--sidebar`) carry 97% alpha. Returns
 * undefined for empties, unresolved `var()` indirection, or invalid values.
 */
function resolveCssColor(value: string): string | undefined {
	if (!value || value.startsWith('var(')) {
		return undefined;
	}

	const canvas = document.createElement('canvas');
	canvas.width = 1;
	canvas.height = 1;
	const context = canvas.getContext('2d', { willReadFrequently: true });

	if (!context) {
		return undefined;
	}

	// Invalid assignments leave fillStyle untouched; a gradient sentinel makes
	// them detectable because a string never survives as a gradient.
	context.globalCompositeOperation = 'copy';
	context.fillStyle = context.createLinearGradient(0, 0, 1, 1);
	context.fillStyle = value;

	if (typeof context.fillStyle !== 'string') {
		return undefined;
	}

	context.fillRect(0, 0, 1, 1);
	const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;

	if (alpha === 0) {
		return undefined;
	}

	return `#${toHexByte(red)}${toHexByte(green)}${toHexByte(blue)}`;
}

/**
 * Formats a color-channel byte as a two-digit hex string.
 * @param channel - The 0–255 channel value
 * @returns The zero-padded two-character hex representation
 */
function toHexByte(channel = 0): string {
	return channel.toString(16).padStart(2, '0');
}
