/**
 * Entity decoding for the naming sanitizers. Nothing in the app HTML-escapes a
 * title, so an encoded `&amp;` reaches naming already encoded from outside —
 * model output, or text pasted from an HTML source — and arrives as those five
 * characters. Decoding is safe here and must not be "fixed" back: these strings
 * become React text nodes and git branch names, never markup, so React escapes
 * on output and leaving the entity encoded is the only way to get the wrong
 * string on screen. Kept free of the pi/sqlite runtime so it unit-tests under
 * Vitest alongside its callers.
 */

/**
 * The named entities that realistically reach a title: HTML's five predefined
 * ones, the non-breaking space, and the typographic punctuation a model reaches
 * for in prose. Numeric forms are decoded generically, so only names live here.
 */
const NAMED_ENTITIES = new Map<string, string>([
	['amp', '&'],
	['apos', "'"],
	['gt', '>'],
	['hellip', '…'],
	['ldquo', '“'],
	['lsquo', '‘'],
	['lt', '<'],
	['mdash', '—'],
	['nbsp', '\u00a0'],
	['ndash', '–'],
	['quot', '"'],
	['rdquo', '”'],
	['rsquo', '’'],
]);

/** Matches a named, decimal (`&#38;`), or hexadecimal (`&#x26;`) entity. */
const ENTITY_PATTERN =
	/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g;

/**
 * The whitespace controls an encoded line can name. They resolve to a plain
 * space rather than to the character itself: every consumer here wants one line,
 * so a decoded `&#10;` that stayed a line break would split a chat title across
 * two lines and demote half of a `# heading` to body text. Dropping them instead
 * is worse — `sanitizeBranchSlug` would read the surviving `&#10;` as digits and
 * cut `fix-10-login`, which is the `admin-amp-management` bug this module exists
 * to prevent.
 */
const WHITESPACE_CONTROLS = new Set([0x09, 0x0a, 0x0d]);

/**
 * Reports whether a numeric entity's code point may reach a title or a branch
 * name. Rejects out-of-range values, unpaired surrogates, and control
 * characters, which carry no meaning in a name.
 * @param codePoint - The parsed code point of a numeric entity.
 * @returns True when the code point is safe to substitute.
 */
function isDecodableCodePoint(codePoint: number): boolean {
	if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
		return false;
	}
	if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
		return false;
	}
	return codePoint >= 0x20 && (codePoint < 0x7f || codePoint > 0x9f);
}

/**
 * Resolves one entity body to the character it names.
 * @param entity - The text between `&` and `;`, such as `amp`, `#38`, or `#x26`.
 * @returns The decoded character, or null when the entity is unknown or names a code point a name must not carry.
 */
function decodeEntity(entity: string): string | null {
	if (!entity.startsWith('#')) {
		return NAMED_ENTITIES.get(entity.toLowerCase()) ?? null;
	}
	const isHex = entity[1] === 'x' || entity[1] === 'X';
	const digits = entity.slice(isHex ? 2 : 1);
	const codePoint = Number.parseInt(digits, isHex ? 16 : 10);
	if (WHITESPACE_CONTROLS.has(codePoint)) {
		return ' ';
	}
	return isDecodableCodePoint(codePoint)
		? String.fromCodePoint(codePoint)
		: null;
}

/**
 * Substitutes every recognized entity once, leaving the rest as written.
 * @param text - Text that may contain HTML entities.
 * @returns The text after a single decode pass.
 */
function decodePass(text: string): string {
	return text.replace(
		ENTITY_PATTERN,
		(match, entity: string) => decodeEntity(entity) ?? match,
	);
}

/**
 * Decodes the HTML entities in a line bound for a chat title, a session-summary
 * heading, or a branch slug, repeating until the result stops changing so
 * doubly-escaped input such as `&amp;amp;` resolves to a single `&`. A bare `&`
 * and any unrecognized entity survive untouched.
 *
 * The loop needs no pass cap to terminate: the shortest entity a pass can
 * substitute is four characters (`&ab;`) and the longest replacement is two,
 * so every pass that changes anything drops at least two characters and the
 * text runs out. A cap would only stop short of the fixpoint and hand back the
 * visible `&amp;` this module exists to remove.
 * @param text - The line a naming sanitizer is about to clean.
 * @returns The text with its entities resolved to the characters they name.
 */
export function decodeHtmlEntities(text: string): string {
	let decoded = text;
	let next = decodePass(decoded);
	while (next !== decoded) {
		decoded = next;
		next = decodePass(decoded);
	}
	return decoded;
}
