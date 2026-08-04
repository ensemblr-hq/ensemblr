/**
 * The one place the app's code surfaces agree on how they look. Every recipe
 * here is shared by the chat code block, the diff preview inside a tool row, the
 * file viewer, and the full diff viewer — the react-diff-view overrides in
 * `styles/index.css` restate the same values for the cells that library owns.
 *
 * Two densities, one rhythm: panels read at `text-code-body` and chat rows at
 * `text-xs`, both on the same `leading-code` row height, so surfaces of
 * different sizes still stack their lines on one grid.
 */

/** Fill, ink, and typeface shared by every code surface, at either density. */
export const CODE_SURFACE_CLASSES = 'bg-code font-mono text-code-foreground';

/** Type size for a code surface that fills a panel or a tab. */
export const CODE_PANEL_TEXT_CLASSES = 'text-code-body leading-code';

/** Type size for a code surface embedded in a conversation row. */
export const CODE_CHAT_TEXT_CLASSES = 'text-xs leading-code';

/**
 * A line-number cell: right-aligned, unselectable, and dimmed against the code
 * beside it. Sized by `width` in `ch` so the padding never eats a digit.
 */
export const CODE_GUTTER_CLASSES =
	'box-content shrink-0 select-none px-code-pad text-right text-code-foreground/40 tabular-nums';

/** Hairline between the gutter and the code, drawn by the gutter nearest it. */
export const CODE_GUTTER_DIVIDER_CLASSES = 'border-code-border border-r';

/**
 * Code beside a gutter: indented by the gutter's own padding, and given room at
 * the end of the line so the last character never touches the scroll edge.
 */
export const CODE_CONTENT_CLASSES = 'whitespace-pre pr-4 pl-code-pad';

/** Fill for a changed row, keyed by the change it represents. */
export const DIFF_ROW_SURFACE = {
	delete: 'bg-diff-deletion-surface',
	insert: 'bg-diff-addition-surface',
	normal: '',
} as const;

/**
 * Fill and ink for a changed row's gutter cell. Full-strength change hue rather
 * than the row's tint, so the line number carries over it the way the real diff
 * viewer's gutter does.
 */
export const DIFF_GUTTER_TINT = {
	delete: 'bg-diff-deletion text-diff-deletion-foreground',
	insert: 'bg-diff-addition text-diff-addition-foreground',
	normal: '',
} as const;
