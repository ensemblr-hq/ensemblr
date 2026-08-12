/** Tallest the popover may grow before the list scrolls instead. */
const MAX_AUTOCOMPLETE_HEIGHT_REM = 24;

/** Height of an autocomplete row: the `h-9` option button. */
const AUTOCOMPLETE_ROW_HEIGHT_REM = 2.25;

/** Popover padding the list has to share the popover with: `p-1.5`, top and bottom. */
const POPOVER_CHROME_HEIGHT_REM = 0.75;

/**
 * Sizes the autocomplete list so Radix ScrollArea receives a definite height. Its
 * viewport is `height: 100%`, which collapses to auto against a `max-height`-only
 * parent and leaves the list overflowing the popover with no scrollbar, so the
 * height is measured out here and clamped against the space the popover has.
 *
 * A sibling of `getRosterHeight` rather than a shared helper: this list carries
 * no header, so its chrome is the popover's own padding and nothing else.
 * @param rowCount - How many rows are about to be rendered.
 * @returns A CSS length for the scroll container.
 */
export function getAutocompleteHeight(rowCount: number): string {
	const visibleRows = Math.max(1, rowCount);
	const contentHeightRem = visibleRows * AUTOCOMPLETE_ROW_HEIGHT_REM;
	const maxListHeightRem =
		MAX_AUTOCOMPLETE_HEIGHT_REM - POPOVER_CHROME_HEIGHT_REM;
	const availableHeight = `calc(var(--radix-popover-content-available-height, 100vh) - ${POPOVER_CHROME_HEIGHT_REM}rem)`;

	return `min(${contentHeightRem}rem, ${maxListHeightRem}rem, ${availableHeight})`;
}
