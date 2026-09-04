/**
 * Single-line node text fitting.
 *
 * Ported from archify's `renderers/shared/text-fit.mjs` and the `textUnits`
 * measurement it depends on from `renderers/shared/utils.mjs`.
 * Copyright (c) archify contributors. Licensed under the MIT License.
 *
 * Node text (`label`, `sublabel`, `tag`) renders as one `<text>` element with
 * `text-anchor="middle"` and is never wrapped. Left unmeasured, an over-long
 * value silently spills across its neighbours — the failure this module closes,
 * by shrinking the text toward a legible minimum instead.
 */

/** Advance width per text unit, per px of font size, and the box's inner padding. */
const NODE_TEXT_FIT = {
	horizontalPadding: 8,
	widthFactor: 0.6,
} as const;

/**
 * Code points that take two columns of advance width: East Asian Wide and
 * Fullwidth per UAX #11, tracking Unicode 17.0. Spelled out as ranges because
 * V8 has no `\p{East_Asian_Width=W}` property escape.
 */
const FULLWIDTH_RE =
	/[\u1100-\u115F\u231A-\u231B\u2329-\u232A\u23E9-\u23EC\u23F0\u23F3\u25FD-\u25FE\u2614-\u2615\u2630-\u2637\u2648-\u2653\u267F\u268A-\u268F\u2693\u26A1\u26AA-\u26AB\u26BD-\u26BE\u26C4-\u26C5\u26CE\u26D4\u26EA\u26F2-\u26F3\u26F5\u26FA\u26FD\u2705\u270A-\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B-\u2B1C\u2B50\u2B55\u2E80-\uA4CF\uA960-\uA97C\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF01-\uFF60\uFFE0-\uFFE6\u{16FE0}-\u{18DFF}\u{1AFF0}-\u{1AFFF}\u{1B000}-\u{1B2FF}\u{1F000}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;

const VARIATION_SELECTOR_FIRST = 0xfe00;
const VARIATION_SELECTOR_LAST = 0xfe0f;
const VARIATION_SELECTOR_TEXT = 0xfe0e;
const VARIATION_SELECTOR_EMOJI = 0xfe0f;

/**
 * Advance width of a string in text units, where an ASCII character is one and
 * a fullwidth or emoji-presentation glyph is two.
 *
 * A variation selector carries no advance of its own — it re-presents the
 * character before it — so a base plus a selector is measured from the
 * selector, not from the base.
 * @param text - The string to measure
 * @returns Its width in text units
 */
export function textUnits(text: string | undefined): number {
	const chars = [...String(text ?? '')];
	let units = 0;
	for (const [index, char] of chars.entries()) {
		const codePoint = char.codePointAt(0) ?? 0;
		if (
			codePoint >= VARIATION_SELECTOR_FIRST &&
			codePoint <= VARIATION_SELECTOR_LAST
		) {
			continue;
		}
		const next = chars[index + 1]?.codePointAt(0) ?? -1;
		if (next === VARIATION_SELECTOR_EMOJI) {
			units += 2;
		} else if (next === VARIATION_SELECTOR_TEXT) {
			units += 1;
		} else {
			units += FULLWIDTH_RE.test(char) ? 2 : 1;
		}
	}
	return units;
}

/**
 * Largest font size at or below `preferred` that fits `text` inside `width`,
 * floored at `minimum` — below that the text is no longer legible and the
 * caller should be reporting a problem instead of shrinking further.
 * @param text - The string to fit
 * @param width - Width of the box it sits in
 * @param preferred - Font size to use when the text already fits
 * @param minimum - Font size below which shrinking stops
 * @returns The font size to render at
 */
export function fittedNodeFontSize(
	text: string | undefined,
	width: number,
	preferred: number,
	minimum: number,
): number {
	const units = Math.max(1, textUnits(text));
	const available = Math.max(1, width - NODE_TEXT_FIT.horizontalPadding);
	const fitted = Math.min(
		preferred,
		available / (units * NODE_TEXT_FIT.widthFactor),
	);
	return Math.max(minimum, Math.floor(fitted * 10) / 10);
}

/**
 * Width `text` occupies at its legible minimum. Compare against
 * {@link availableNodeTextWidth} to decide whether shrink-to-fit can rescue it.
 * @param text - The string to measure
 * @param minimum - Font size below which shrinking stops
 * @returns The width the text still needs at that size
 */
export function minimumNodeTextWidth(
	text: string | undefined,
	minimum: number,
): number {
	return textUnits(text) * minimum * NODE_TEXT_FIT.widthFactor;
}

/**
 * Text width available inside a box.
 * @param width - The box's outer width
 * @returns The width text may occupy inside it
 */
export function availableNodeTextWidth(width: number): number {
	return width - NODE_TEXT_FIT.horizontalPadding;
}
