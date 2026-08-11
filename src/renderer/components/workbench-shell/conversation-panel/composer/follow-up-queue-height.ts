/** Tallest the queue may grow before it scrolls instead. */
const MAX_QUEUE_HEIGHT_REM = 20;

/** Height of a queue row: a two-line `text-xs` body inside `py-1.5`. */
const QUEUE_ROW_HEIGHT_REM = 3.25;

/** Popover padding, border, and header the list has to share the popover with. */
const PANEL_CHROME_HEIGHT_REM = 2.75;

/**
 * Sizes the queue so Radix ScrollArea receives a definite height. Its viewport
 * is `height: 100%`, which collapses to auto against a `max-height`-only parent
 * and leaves the list overflowing the popover with no scrollbar, so the height
 * is measured out here and clamped against the space the popover actually has.
 *
 * A sibling of `getRosterHeight` rather than a shared helper: a queue row is two
 * lines to the MCP roster's one, so the two differ in the constant that matters.
 * @param entryCount - How many rows are about to be rendered.
 * @returns A CSS length for the scroll container.
 */
export function getQueueHeight(entryCount: number): string {
	const contentHeightRem = entryCount * QUEUE_ROW_HEIGHT_REM;
	const availableHeight = `calc(var(--radix-popover-content-available-height, 100vh) - ${PANEL_CHROME_HEIGHT_REM}rem)`;

	return `min(${contentHeightRem}rem, ${MAX_QUEUE_HEIGHT_REM}rem, ${availableHeight})`;
}
