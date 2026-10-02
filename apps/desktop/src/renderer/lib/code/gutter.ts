/** Narrowest gutter the app draws, so a short file still reads as a column. */
const MIN_GUTTER_DIGITS = 2;

/**
 * Width in characters of the line-number column for a surface whose highest
 * line number is `maxLineNumber`. Every code surface sizes its gutter this way,
 * so a file viewer, a diff, and a chat code block of the same length line their
 * content up at the same offset.
 * @param maxLineNumber - Highest line number the surface will render
 * @returns The gutter's character width, excluding its padding
 */
export function codeGutterDigits(maxLineNumber: number): number {
	return Math.max(MIN_GUTTER_DIGITS, String(Math.max(0, maxLineNumber)).length);
}
