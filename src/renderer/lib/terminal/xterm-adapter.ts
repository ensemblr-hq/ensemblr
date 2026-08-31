import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
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
	'"JetBrainsMono Nerd Font Mono", "JetBrains Mono Variable", ui-monospace, monospace';
const DEFAULT_FONT_SIZE = 12;
const DEFAULT_SCROLLBACK = 10_000;

/**
 * Style and weight prefixes for the four faces xterm rasterizes separately.
 * `document.fonts` addresses one face per prefix, so bold and italic cells stay
 * on the fallback font unless each is requested in its own right.
 */
const FONT_FACE_VARIANTS = ['', 'bold ', 'italic ', 'italic bold '];

/**
 * Stack the font family round-trips through to make xterm's option value change,
 * which is the only thing that re-runs the cell measurement.
 */
const FONT_REMEASURE_SENTINEL = 'monospace';

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
		// The WebGL atlas rasterizes glyphs onto a canvas built with
		// `alpha: allowTransparency`, and Skia stem-darkens text only on an opaque
		// one — turning this on costs dark-on-light cells ~26% of their ink.
		allowTransparency: false,
		convertEol: false,
		cursorBlink: !readOnly,
		cursorInactiveStyle: readOnly ? 'none' : 'outline',
		cursorStyle: readOnly ? 'underline' : 'block',
		disableStdin: readOnly,
		fontFamily,
		fontSize,
		linkHandler: {
			/** Sends OSC 8 hyperlink clicks down the same external-open path. */
			activate: openTerminalLink,
		},
		scrollback,
		theme: readThemeFromDocument(),
	});
	const fitAddon = new FitAddon();
	terminal.loadAddon(fitAddon);
	terminal.loadAddon(new WebLinksAddon(openTerminalLink));
	const themeObserver = observeDocumentTheme(() => {
		terminal.options.theme = readThemeFromDocument();
	});
	let disposed = false;
	let activeFont = { family: fontFamily, size: fontSize };
	let fontReady: Promise<void> = Promise.resolve();

	/**
	 * Starts loading the faces the terminal draws with and, when any of them was
	 * still missing, redraws the surface once they arrive. A stack the user has
	 * since moved off is dropped rather than redrawn, so a slow load cannot
	 * reinstate the font its request was made for.
	 */
	const requestFontFaces = (): void => {
		const { family, size } = activeFont;
		const loading = loadTerminalFontFaces(family, size);
		fontReady = loading
			? loading.then(() => {
					if (!disposed && activeFont.family === family) {
						redrawWithLoadedFont(terminal, family);
					}
				})
			: Promise.resolve();
	};

	return {
		attach: (element) => {
			terminal.open(element);
			loadWebglRenderer(terminal);
			requestFontFaces();
		},
		clear: () => terminal.clear(),
		dispose: () => {
			disposed = true;
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
		getSelection: () => terminal.getSelection(),
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
			activeFont = {
				family: nextFamily ?? activeFont.family,
				size: nextSize ?? activeFont.size,
			};
			requestFontFaces();
		},
		setScrollback: (lines) => {
			terminal.options.scrollback = lines;
		},
		whenFontReady: () => fontReady,
		write: (data) => terminal.write(data),
	};
}

/**
 * Requests every face of a font stack and resolves once they are rasterizable.
 *
 * Canvas text — both xterm's cell measurement and the WebGL glyph atlas —
 * silently substitutes the fallback font for a `@font-face` that has not
 * finished loading, and unlike DOM text it neither starts the fetch nor repaints
 * when one lands. The bundled Nerd Font is a `url()` face, so a surface opened
 * before some other part of the UI happened to request it would otherwise keep
 * the fallback for its whole lifetime. `document.fonts.ready` cannot stand in
 * for this: it settles the loads already in flight rather than starting any.
 *
 * `allSettled` rather than `all`, because `fonts.load` rejects when a face
 * fails to fetch or decode: `all` would reject the whole batch on the first
 * such face, dropping the redraw for the three that did land, and the rejection
 * would escape the `try` below — which only covers `fonts.check` throwing on an
 * unparseable shorthand — into the caller's un-caught `then` chain. The returned
 * promise therefore never rejects.
 * @param fontFamily - CSS font-family stack the terminal draws with.
 * @param fontSize - Font size in pixels, needed to form a valid CSS shorthand.
 * @returns A promise settling when the faces are usable, or null when they
 * already are and nothing needs redrawing.
 */
function loadTerminalFontFaces(
	fontFamily: string,
	fontSize: number,
): Promise<void> | null {
	const fonts = typeof document === 'undefined' ? undefined : document.fonts;

	if (!fonts) {
		return null;
	}

	const faces = FONT_FACE_VARIANTS.map(
		(variant) => `${variant}${fontSize}px ${fontFamily}`,
	);

	try {
		if (faces.every((face) => fonts.check(face))) {
			return null;
		}

		return Promise.allSettled(faces.map((face) => fonts.load(face))).then(
			() => undefined,
		);
	} catch {
		return null;
	}
}

/**
 * Re-measures the cell box and discards every cached glyph so an already-open
 * surface picks up a font face that finished loading after it was built.
 *
 * Neither happens on its own. xterm ignores an option write that does not change
 * the value, so the measurement only re-runs if the family string actually
 * differs — hence the round trip through {@link FONT_REMEASURE_SENTINEL}. The
 * WebGL atlas keys its glyph cache on that same string, so settling back on the
 * original stack hands it the pages it rasterized with the fallback font;
 * `clearTextureAtlas` is what throws those away.
 * @param terminal - The opened terminal whose font has just become available.
 * @param fontFamily - The stack to settle back on after the sentinel.
 */
function redrawWithLoadedFont(terminal: Terminal, fontFamily: string): void {
	terminal.options.fontFamily = FONT_REMEASURE_SENTINEL;
	terminal.options.fontFamily = fontFamily;
	terminal.clearTextureAtlas();
}

/**
 * Upgrades an opened terminal to the WebGL renderer, leaving xterm's DOM
 * renderer in place wherever the GPU cannot serve one.
 *
 * The DOM renderer lays out a span per cell, so a streaming agent turn costs a
 * relayout of the whole viewport per frame — on the renderer's main thread,
 * where the rest of the UI also lives. WebGL draws the same cells from a glyph
 * atlas and leaves that thread free.
 *
 * Must run after `terminal.open`: the addon takes over a canvas the terminal
 * only creates once it has a container. Losing the GL context (a driver reset,
 * a suspend, an out-of-memory GPU) disposes the addon, which is how xterm
 * documents dropping back to the DOM renderer mid-session.
 *
 * Teardown is left to `terminal.dispose`, which disposes every addon it loaded.
 * Disposing this one first instead would make it hand the render service a
 * freshly built DOM renderer — rows and an injected stylesheet — microseconds
 * before the terminal tears that renderer down again; the addon skips that
 * restore only once the terminal's core is already disposed.
 * @param terminal - An xterm terminal that has already been opened.
 */
function loadWebglRenderer(terminal: Terminal): void {
	try {
		const addon = new WebglAddon();
		addon.onContextLoss(() => {
			addon.dispose();
		});
		terminal.loadAddon(addon);
	} catch {
		// A GPU that cannot serve a context throws out of the addon's activate;
		// xterm is left on the DOM renderer it already had, so there is no
		// teardown to do here.
	}
}

/**
 * Sends a clicked terminal hyperlink to the default browser through the main
 * process, covering both regex-detected URLs and OSC 8 hyperlinks. Replaces
 * xterm's two built-in handlers, which each call `window.open()` with no URL
 * (the OSC 8 one behind a `confirm()` prompt): the app's window-open guard sees
 * `about:blank`, refuses to open it externally, and the click silently does
 * nothing.
 * @param _event - The originating click, unused — the URI carries everything.
 * @param uri - The link target under the cursor.
 */
function openTerminalLink(_event: MouseEvent, uri: string): void {
	window.ensemblr?.openExternal(uri).catch((error: unknown) => {
		console.error('[terminal] failed to open link', uri, error);
	});
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
 * sidebar background. Every color resolves opaque, which is what lets the
 * surface run with `allowTransparency` off. Falls back to `#00000000` with
 * inherited colors when there is no document (tests); a real window always
 * resolves the tokens.
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
