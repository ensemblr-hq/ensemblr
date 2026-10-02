/**
 * The cap every block of review context is trimmed to before it reaches an
 * agent composer, and the trim itself.
 *
 * It lives in `shared/` rather than beside the renderer's other review helpers
 * because both processes now compose a review prompt: the Review button does it
 * in the renderer, and `startReview` does it in main for an agent that asked for
 * the same review. Two copies of the cap would drift the moment one moved.
 */

/**
 * Conservative payload cap for review context inserted into the agent composer.
 * The agent does not report context usage ahead of submit, so blocks are truncated
 * with an explicit marker instead of silently overflowing (ENS-053).
 */
export const REVIEW_CONTEXT_CHAR_LIMIT = 24_000;

/**
 * Truncates a context block at the cap, appending an explicit marker.
 * @param text - The block to bound.
 * @returns The text unchanged, or its truncated prefix plus the marker.
 */
export function clampReviewContext(text: string): string {
	if (text.length <= REVIEW_CONTEXT_CHAR_LIMIT) {
		return text;
	}
	return `${text.slice(0, REVIEW_CONTEXT_CHAR_LIMIT)}\n…[truncated — full content exceeds the review context limit]`;
}
