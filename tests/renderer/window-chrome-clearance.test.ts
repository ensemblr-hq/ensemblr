/**
 * Where Ensemblr draws its own title bar, the room the app leaves for it is the
 * one piece of layout a third party rewrites behind our back: Radix locks the
 * page scroll through `react-remove-scroll-bar`, whose `margin` gap mode reads
 * `body`'s margin offsets and writes them back as *padding*. `body { margin: 0 }`
 * therefore becomes `body { padding-top: 0 }` the moment any select, dialog or
 * dropdown opens, and the injected style is unlayered so it outranks ours.
 *
 * The clearance lives on the app root for that reason. These tests pin it there,
 * because putting it back on `body` reads as the more natural place and fails
 * only on Linux, only once a menu is opened.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const STYLESHEET = readFileSync(
	fileURLToPath(
		new URL('../../src/renderer/styles/index.css', import.meta.url),
	),
	'utf8',
);

const CLEARANCE =
	'padding-block-start: var(--ensemblr-window-chrome-inset-top)';

/**
 * Reads one top-level rule out of the stylesheet's `@layer base` block.
 * @param selector - The selector whose declarations to read.
 * @returns The rule's declarations, or an empty string when it has no rule.
 */
function declarationsFor(selector: string): string {
	const rule = new RegExp(`\\n\\t${selector} \\{([^{}]*)\\}`).exec(STYLESHEET);
	return rule?.[1] ?? '';
}

test('the app root clears the title bar Ensemblr draws above it', () => {
	expect(declarationsFor('#root')).toContain(CLEARANCE);
});

test('body does not, because Radix rewrites its padding on every open menu', () => {
	expect(declarationsFor('body')).not.toContain('padding');
});
