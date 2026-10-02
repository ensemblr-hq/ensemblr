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

import { expect, test } from 'vitest';

import { readStyleRule } from './support/stylesheet';

const CLEARANCE =
	'padding-block-start: var(--ensemblr-window-chrome-inset-top)';
const SHEET_HEIGHT = 'block-size: var(--ensemblr-shell-height)';
const SHEET_OFFSET =
	'inset-block-start: var(--ensemblr-window-chrome-inset-top)';

/**
 * Reads one top-level rule's declarations, treating a rule the stylesheet no
 * longer carries as one that declares nothing.
 * @param anchor - The rule's first selector, written as the stylesheet writes it.
 * @returns The rule's declarations, or an empty string when it has no rule.
 */
function declarationsFor(anchor: string): string {
	return readStyleRule(anchor)?.declarations ?? '';
}

test('the app root clears the title bar Ensemblr draws above it', () => {
	expect(declarationsFor('#root')).toContain(CLEARANCE);
});

test('body does not, because Radix rewrites its padding on every open menu', () => {
	expect(declarationsFor('body')).not.toContain('padding');
});

test('side sheets clear the custom title bar without losing usable height', () => {
	const sideSheetRule = declarationsFor(
		'[data-slot="sheet-content"][data-side="left"]',
	);

	expect(sideSheetRule).toContain(SHEET_HEIGHT);
	expect(sideSheetRule).toContain(SHEET_OFFSET);
});
