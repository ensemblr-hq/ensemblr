import { expect, test } from 'vitest';

import { getAutocompleteHeight } from '../../src/renderer/components/workbench-shell/conversation-panel/composer/autocomplete-height';

// Radix's ScrollArea viewport is `height: 100%`, which collapses to auto against
// a `max-height`-only parent — the list then spills out of the popover with no
// scrollbar. The height has to be a definite length for the viewport to scroll.
test('the list height is a definite length, not a max', () => {
	expect(getAutocompleteHeight(4)).toBe(
		'min(9rem, 23.25rem, calc(var(--radix-popover-content-available-height, 100vh) - 0.75rem))',
	);
});

// The height measures the rows alone. Adding the popover's own padding here too
// would leave the scroll viewport taller than what it scrolls, parking dead
// space under the last row.
test('the height counts rows only, not the padding around them', () => {
	expect(getAutocompleteHeight(1).startsWith('min(2.25rem,')).toBe(true);
});

test('an empty list still reserves one row', () => {
	expect(getAutocompleteHeight(0)).toBe(getAutocompleteHeight(1));
});

// Both clamps are short by the popover's padding, so a full list plus its
// chrome still fits the 24rem cap and the space Radix says it has.
test('the list stops growing before the popover outgrows its cap', () => {
	expect(getAutocompleteHeight(40).startsWith('min(90rem, 23.25rem,')).toBe(
		true,
	);
});
