/**
 * How many lines a source may carry before highlighting is refused.
 *
 * Shiki's `codeToTokens` is one uninterruptible synchronous pass on the renderer
 * main thread, and it costs roughly half a millisecond per line of ordinary
 * source: 500 lines measured at 352 ms, 2,000 at 951 ms, 5,000 at 2,389 ms. A
 * diff pays it twice, once per side. A thousand lines is the point where the
 * freeze is still shorter than the read that follows it.
 */
export const MAX_HIGHLIGHT_LINES = 1_000;

/**
 * How long one line may be before highlighting is refused.
 *
 * Cost is roughly quadratic in the length of a *single* line rather than in the
 * file: 1,013 characters on one line measured at 61 ms, 2,013 at 235 ms, 4,013
 * at 923 ms, 8,013 at 6.4 s, and 32,013 at 62 s. A committed bundle, a minified
 * stylesheet, or a base64 blob an agent echoed all reach that range, so the
 * per-line bound is the one that matters most.
 */
export const MAX_HIGHLIGHT_LINE_LENGTH = 1_000;

/**
 * How many characters a source may carry in total before highlighting is
 * refused, as the cheap bound that settles most oversized payloads before the
 * per-line scan runs.
 */
export const MAX_HIGHLIGHT_CHARS = 100_000;

/**
 * Whether a source is small enough to tokenize on the renderer main thread.
 *
 * Every surface that highlights already renders its plain text first and swaps
 * colour in when tokens arrive, so refusing the work costs the payload its
 * syntax colours and nothing else — which is the better trade against a window
 * that stops painting for seconds.
 * @param code - Source text a caller is about to hand to Shiki
 * @returns True when the source is within every budget
 */
export function isWithinHighlightBudget(code: string): boolean {
	if (code.length > MAX_HIGHLIGHT_CHARS) {
		return false;
	}
	let lines = 1;
	let lineStart = 0;
	for (let index = 0; index < code.length; index += 1) {
		if (code.charCodeAt(index) !== 10) {
			continue;
		}
		if (index - lineStart > MAX_HIGHLIGHT_LINE_LENGTH) {
			return false;
		}
		lines += 1;
		if (lines > MAX_HIGHLIGHT_LINES) {
			return false;
		}
		lineStart = index + 1;
	}
	return code.length - lineStart <= MAX_HIGHLIGHT_LINE_LENGTH;
}
