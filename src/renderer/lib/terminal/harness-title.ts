/**
 * Helpers for interpreting the OSC window titles agent-harness TUIs emit. A
 * harness animates a leading spinner/decoration glyph while it is working and
 * sets a clean conversation title when idle, so the presence of that decoration
 * doubles as a "busy" signal and its absence yields the real title text.
 */

/** Unicode braille block (U+2800–U+28FF): the frames many TUIs animate as spinners. */
const BRAILLE_BLOCK_START = 0x2800;
const BRAILLE_BLOCK_END = 0x28ff;
/** Zero-width joiner and variation-selector-16, used to compose emoji decoration. */
const ZERO_WIDTH_JOINER = 0x200d;
const VARIATION_SELECTOR_16 = 0xfe0f;

/**
 * Reports whether a code point is harness-title decoration: whitespace, a
 * symbol/emoji glyph, a braille spinner frame, or an emoji joiner. Regular
 * punctuation is intentionally excluded so a path-like title survives.
 * @param char - A single-code-point string to classify.
 * @returns True when the character is leading decoration to strip.
 */
function isTitleDecorationChar(char: string): boolean {
	const codePoint = char.codePointAt(0) ?? 0;
	if (
		(codePoint >= BRAILLE_BLOCK_START && codePoint <= BRAILLE_BLOCK_END) ||
		codePoint === ZERO_WIDTH_JOINER ||
		codePoint === VARIATION_SELECTOR_16
	) {
		return true;
	}
	return /^[\s\p{So}\p{Sk}]$/u.test(char);
}

/**
 * Strips the leading spinner/decoration glyphs (and surrounding whitespace) that
 * agent TUIs prepend to their window title, leaving the meaningful title text.
 * Only whitespace and symbol/emoji/braille-spinner glyphs are removed — regular
 * punctuation is kept so a path-like title (e.g. `/repo/foo`) survives intact.
 * @param rawTitle - The raw OSC window title from the harness.
 * @returns The title with leading decoration removed.
 */
export function stripHarnessTitleDecoration(rawTitle: string): string {
	const chars = Array.from(rawTitle);
	let start = 0;
	while (start < chars.length && isTitleDecorationChar(chars[start])) {
		start += 1;
	}
	return chars.slice(start).join('').trim();
}

/**
 * Reports whether a harness title indicates active work: a leading decoration
 * glyph (the animated spinner frame) is present. Each spinner frame re-emits the
 * title, so callers debounce this to keep a working agent lit between frames.
 * @param rawTitle - The raw OSC window title from the harness.
 * @returns True when the title carries a leading spinner/decoration glyph.
 */
export function isHarnessTitleBusy(rawTitle: string): boolean {
	return rawTitle.trim() !== stripHarnessTitleDecoration(rawTitle);
}
