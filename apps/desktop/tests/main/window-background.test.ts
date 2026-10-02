/**
 * The window's backing colour is what Chromium shows wherever the page has not
 * painted — the frame before first paint, a resize the compositor has not caught
 * up with, and any frame a busy renderer misses. It was a fixed near-black,
 * which under a light theme read as the whole window blinking dark. It now
 * tracks the renderer's own canvas, and these tests hold it to that: once for
 * the resolution rule, once for the pairing with the stylesheet, which nothing
 * else can enforce across the process boundary.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { resolveWindowBackgroundColor } from '../../src/main/app/window-background.ts';

const repositoryRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
	'..',
);

/**
 * The `--ensemblr-canvas` cuts the hex constants in `window-background.ts` were
 * derived from, as Chromium resolves them: `oklch(0.21 0.009 35)` → `#1c1716`
 * and `oklch(0.955 0.004 265)` → `#eff0f3`. Re-derive both if the palette moves.
 */
const CANVAS_DECLARATION =
	'--ensemblr-canvas: var(--ensemblr-if-light, oklch(0.955 0.004 265))\n\t\tvar(--ensemblr-if-dark, oklch(0.21 0.009 35));';

describe('window background colour', () => {
	test('follows an explicitly chosen theme whatever the OS asks for', () => {
		expect(
			resolveWindowBackgroundColor({ prefersDark: true, theme: 'light' }),
		).toBe('#eff0f3');
		expect(
			resolveWindowBackgroundColor({ prefersDark: false, theme: 'dark' }),
		).toBe('#1c1716');
	});

	test('follows the OS under the system theme', () => {
		expect(
			resolveWindowBackgroundColor({ prefersDark: true, theme: 'system' }),
		).toBe('#1c1716');
		expect(
			resolveWindowBackgroundColor({ prefersDark: false, theme: 'system' }),
		).toBe('#eff0f3');
	});

	test('is never the old fixed near-black, which is what flashed', () => {
		for (const theme of ['dark', 'light', 'system'] as const) {
			for (const prefersDark of [true, false]) {
				expect(resolveWindowBackgroundColor({ prefersDark, theme })).not.toBe(
					'#0b0808',
				);
			}
		}
	});

	test('still matches the canvas the renderer paints', () => {
		const stylesheet = readFileSync(
			path.join(repositoryRoot, 'src/renderer/styles/index.css'),
			'utf8',
		);

		expect(stylesheet).toContain(CANVAS_DECLARATION);
	});
});
