/**
 * Linear-time scanners for the secret shapes whose regular expression
 * backtracks: each matches exactly what its regex in `redaction.ts` matches,
 * but visits every character a bounded number of times, so a long line of
 * build output cannot stall the main process. `tests/shared/redaction.test.ts`
 * holds every scanner to its regex.
 */

/** Opening armor line of a PEM private key. */
const PRIVATE_KEY_BEGIN_SOURCE = '-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----';

/** Closing armor line of a PEM private key. */
const PRIVATE_KEY_END_SOURCE = '-----END (?:[A-Z]+ )?PRIVATE KEY-----';

/** A word character, the class `\b` is defined over. */
const WORD_CHARACTER = /[A-Za-z0-9_]/;

/** A character a JWT segment is made of. */
const JWT_SEGMENT_CHARACTER = /[A-Za-z0-9_-]/;

/** A character a URL scheme is made of. */
const SCHEME_CHARACTER = /[a-z0-9+.-]/i;

/** A character an assignment key is made of. */
const KEY_RUN = '[A-Za-z0-9_.-]+';

/** Shortest first JWT segment after its `eyJ` prefix. */
const JWT_MIN_HEADER_TAIL = 10;

/**
 * Finds the end of the run of `character` starting at `from`.
 * @param text - Text to scan.
 * @param from - Offset to start at.
 * @param character - The run's character class.
 * @returns The offset of the first character outside the run.
 */
function runEnd(text: string, from: number, character: RegExp): number {
	let index = from;
	while (index < text.length && character.test(text.charAt(index))) {
		index += 1;
	}
	return index;
}

/**
 * Replaces every PEM private-key block, armor to armor. Matches
 * `BEGIN…[\s\S]*?…END`: each block ends at the first END after its BEGIN.
 * @param text - Text to scan.
 * @param replacement - What a block is replaced with.
 * @returns The text with every complete block replaced.
 */
export function replacePrivateKeyBlocks(
	text: string,
	replacement: string,
): string {
	if (!text.includes('-----BEGIN ')) {
		return text;
	}
	const begin = new RegExp(PRIVATE_KEY_BEGIN_SOURCE, 'g');
	const end = new RegExp(PRIVATE_KEY_END_SOURCE, 'g');
	const parts: string[] = [];
	let cursor = 0;
	for (;;) {
		begin.lastIndex = cursor;
		const opening = begin.exec(text);
		if (opening === null) {
			break;
		}
		end.lastIndex = opening.index + opening[0].length;
		const closing = end.exec(text);
		if (closing === null) {
			break;
		}
		parts.push(text.slice(cursor, opening.index), replacement);
		cursor = closing.index + closing[0].length;
	}
	return parts.length === 0 ? text : parts.join('') + text.slice(cursor);
}

/**
 * Measures a JWT starting at `start`, which holds `eyJ` after a word boundary.
 * Every start inside one segment run shares the run's end, so a failure here
 * fails them all and the caller may skip to `skipTo`.
 * @param text - Text to scan.
 * @param start - Offset of the `eyJ` prefix.
 * @returns The match end, or null with the offset the next search may resume at.
 */
function measureJwt(
	text: string,
	start: number,
): { end: number | null; skipTo: number } {
	const headerEnd = runEnd(text, start + 3, JWT_SEGMENT_CHARACTER);
	const fail = { end: null, skipTo: Math.max(headerEnd, start + 1) };
	if (headerEnd - start - 3 < JWT_MIN_HEADER_TAIL || text[headerEnd] !== '.') {
		return fail;
	}
	const payloadEnd = runEnd(text, headerEnd + 1, JWT_SEGMENT_CHARACTER);
	if (payloadEnd === headerEnd + 1 || text[payloadEnd] !== '.') {
		return fail;
	}
	const end = runEnd(text, payloadEnd + 1, JWT_SEGMENT_CHARACTER);
	return { end, skipTo: end };
}

/**
 * Replaces every JWT: `eyJ` after a word boundary, then three dot-separated
 * segments, the first at least 13 characters long.
 * @param text - Text to scan.
 * @param replacement - What a token is replaced with.
 * @returns The text with every token replaced.
 */
export function replaceJwts(text: string, replacement: string): string {
	const parts: string[] = [];
	let cursor = 0;
	let search = 0;
	for (;;) {
		const start = text.indexOf('eyJ', search);
		if (start === -1) {
			break;
		}
		if (start > 0 && WORD_CHARACTER.test(text.charAt(start - 1))) {
			search = start + 1;
			continue;
		}
		const { end, skipTo } = measureJwt(text, start);
		search = skipTo;
		if (end !== null) {
			parts.push(text.slice(cursor, start), replacement);
			cursor = end;
		}
	}
	return parts.length === 0 ? text : parts.join('') + text.slice(cursor);
}

/**
 * Finds where the leftmost URL scheme ending at a `://` starts: the first
 * letter of the scheme-character run before it, never before `floor`.
 * @param text - Text to scan.
 * @param colon - Offset of the `:` in `://`.
 * @param floor - Earliest offset a match may start at.
 * @returns The scheme's start, or -1 when the run holds no letter.
 */
function schemeStart(text: string, colon: number, floor: number): number {
	let runStart = colon;
	while (runStart > floor && SCHEME_CHARACTER.test(text.charAt(runStart - 1))) {
		runStart -= 1;
	}
	for (let index = runStart; index < colon; index += 1) {
		if (/[a-z]/i.test(text.charAt(index))) {
			return index;
		}
	}
	return -1;
}

/**
 * Measures the `user:password@` that must follow a `://`.
 * @param text - Text to scan.
 * @param afterSlashes - Offset just past `://`.
 * @returns The offsets of the password and of its `@`, or null when absent.
 */
function measureUserinfo(
	text: string,
	afterSlashes: number,
): { at: number; password: number } | null {
	const user = /[^\s/@:]+/y;
	user.lastIndex = afterSlashes;
	if (user.exec(text) === null || text[user.lastIndex] !== ':') {
		return null;
	}
	const password = user.lastIndex + 1;
	const secret = /[^\s/@]+/y;
	secret.lastIndex = password;
	if (secret.exec(text) === null || text[secret.lastIndex] !== '@') {
		return null;
	}
	return { at: secret.lastIndex, password };
}

/**
 * Replaces the password in every `scheme://user:password@` URL, keeping the
 * scheme, the user, and the `@`.
 * @param text - Text to scan.
 * @param replacement - What a password is replaced with.
 * @returns The text with every URL password replaced.
 */
export function replaceUrlPasswords(text: string, replacement: string): string {
	const parts: string[] = [];
	let cursor = 0;
	let search = 0;
	for (;;) {
		const colon = text.indexOf('://', search);
		if (colon === -1) {
			break;
		}
		search = colon + 1;
		const userinfo =
			schemeStart(text, colon, cursor) === -1
				? null
				: measureUserinfo(text, colon + 3);
		if (userinfo !== null) {
			parts.push(text.slice(cursor, userinfo.password), replacement, '@');
			cursor = userinfo.at + 1;
			search = cursor;
		}
	}
	return parts.length === 0 ? text : parts.join('') + text.slice(cursor);
}

/**
 * Replaces the value of every secret-named assignment. A key is the run of key
 * characters from its first word character to the run's end — every start the
 * regex could try inside one run shares that end — and it must contain a key
 * source, then a `=` or `:` separator and a value.
 * @param text - Text to scan.
 * @param keyProbe - Unanchored, non-global test for a key source inside a key.
 * @param replacement - What a value is replaced with.
 * @returns The text with every secret-named value replaced.
 */
export function replaceAssignmentValues(
	text: string,
	keyProbe: RegExp,
	replacement: string,
): string {
	const keys = new RegExp(KEY_RUN, 'g');
	const value = /(\s*[=:]\s*)(["']?)([^\s"',;]+)/y;
	const parts: string[] = [];
	let cursor = 0;
	for (let run = keys.exec(text); run !== null; run = keys.exec(text)) {
		const offset = run[0].search(WORD_CHARACTER);
		const key = offset === -1 ? '' : run[0].slice(offset);
		if (key === '' || !keyProbe.test(key)) {
			continue;
		}
		value.lastIndex = run.index + run[0].length;
		const assigned = value.exec(text);
		if (assigned === null) {
			continue;
		}
		parts.push(
			text.slice(cursor, run.index + offset),
			key,
			assigned[1] ?? '',
			assigned[2] ?? '',
			replacement,
		);
		cursor = value.lastIndex;
		keys.lastIndex = cursor;
	}
	return parts.length === 0 ? text : parts.join('') + text.slice(cursor);
}
