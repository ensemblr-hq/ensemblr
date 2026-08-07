/** Tallest the roster may grow before it scrolls instead. */
const MAX_ROSTER_HEIGHT_REM = 18;

/** Height of a roster row: `text-xs` line box inside `py-1`. */
const SERVER_ROW_HEIGHT_REM = 1.5;

/** Popover padding, border, and header the roster has to share the popover with. */
const PANEL_CHROME_HEIGHT_REM = 2.75;

/**
 * Sizes the roster so Radix ScrollArea receives a definite height. Its viewport
 * is `height: 100%`, which collapses to auto against a `max-height`-only parent
 * and leaves the list overflowing the popover with no scrollbar, so the height
 * is measured out here and clamped against the space the popover actually has.
 * @param serverCount - How many rows are about to be rendered.
 * @returns A CSS length for the scroll container.
 */
export function getRosterHeight(serverCount: number): string {
	const contentHeightRem = serverCount * SERVER_ROW_HEIGHT_REM;
	const availableHeight = `calc(var(--radix-popover-content-available-height, 100vh) - ${PANEL_CHROME_HEIGHT_REM}rem)`;

	return `min(${contentHeightRem}rem, ${MAX_ROSTER_HEIGHT_REM}rem, ${availableHeight})`;
}
