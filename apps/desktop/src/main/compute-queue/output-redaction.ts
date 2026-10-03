import {
	createTextRedactor,
	REDACTED,
	SECRET_VALUE_PATTERNS,
} from '../../shared/redaction.ts';

/**
 * Most characters handed to the shared redactor in one call. Its assignment
 * and URL patterns backtrack quadratically over a long run of word characters,
 * and it runs on the main process's event loop, so longer text is redacted in
 * segments of at most this size.
 */
const REDACT_SEGMENT_CHARS = 2 * 1024;

/** Characters no secret shape continues across, preferred as a segment cut. */
const SEGMENT_BREAK_CHARACTERS = new Set([
	' ',
	'\t',
	'\r',
	'"',
	"'",
	',',
	';',
	'{',
	'}',
	'[',
	']',
	'(',
	')',
	'<',
	'>',
	'|',
]);

/** Opening armor line of a PEM private key. */
const PRIVATE_KEY_BEGIN = /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g;

/** Closing armor line of a PEM private key. */
const PRIVATE_KEY_END = /-----END (?:[A-Z]+ )?PRIVATE KEY-----/;

/** Cheap substring every opening armor line contains. */
const PRIVATE_KEY_BEGIN_PREFIX = '-----BEGIN ';

/** The shared corpus's whole-block PEM matcher. */
const PRIVATE_KEY_BLOCK = SECRET_VALUE_PATTERNS.find(
	(entry) => entry.id === 'pem-private-key',
)?.pattern;

/** Shortest literal the shared redactor replaces; mirrors its own floor. */
const MINIMUM_LITERAL_LENGTH = 4;

/** Redaction for one job's output stream, safe on text of any length. */
export interface OutputRedactor {
	/** Characters a cut must keep back so no literal straddles it. */
	literalHoldChars: number;
	/** Redacts finished text: whole private-key blocks, then bounded segments. */
	redact: (text: string) => string;
	/** Replaces only the literal secret values, in one linear pass. */
	redactLiterals: (text: string) => string;
}

/**
 * Adds every line of a multi-line secret as a literal of its own, so a value
 * whose lines arrive in different pipe chunks is still redacted line by line.
 * @param values - Literal secret values as the environment holds them.
 * @returns The values plus each line, raw and trimmed, of the multi-line ones.
 */
export function expandRedactValues(values: readonly string[]): string[] {
	const expanded = new Set<string>(values);
	for (const value of values) {
		if (!value.includes('\n')) {
			continue;
		}
		for (const line of value.split(/\r?\n/)) {
			expanded.add(line);
			expanded.add(line.trim());
		}
	}
	return Array.from(expanded).filter(
		(value) => value.length >= MINIMUM_LITERAL_LENGTH,
	);
}

/**
 * Finds the start of the line holding a private-key armor that has not been
 * closed yet, so a caller can hold the block back until its END arrives.
 * @param text - Text to scan.
 * @returns The offset of that line, or -1 when every key block is closed.
 */
export function openPrivateKeyLineStart(text: string): number {
	if (!text.includes(PRIVATE_KEY_BEGIN_PREFIX)) {
		return -1;
	}
	let lastBegin = -1;
	for (const match of text.matchAll(PRIVATE_KEY_BEGIN)) {
		lastBegin = match.index;
	}
	if (lastBegin === -1 || PRIVATE_KEY_END.test(text.slice(lastBegin))) {
		return -1;
	}
	return text.lastIndexOf('\n', lastBegin) + 1;
}

/**
 * Replaces an unclosed private-key block, from its line to the end, with the
 * placeholder. Used where the block can no longer wait for its END.
 * @param text - Text that may end inside an open key block.
 * @returns The text with any open block masked.
 */
export function maskOpenPrivateKey(text: string): string {
	const start = openPrivateKeyLineStart(text);
	return start === -1 ? text : `${text.slice(0, start)}${REDACTED}\n`;
}

/**
 * Picks where a segment of at most `limit` characters starting at `from` ends:
 * after the last newline, else after the last break character, else at the limit.
 * @param text - Text being segmented.
 * @param from - Segment start.
 * @param limit - Longest segment allowed.
 * @returns The exclusive end offset of the segment.
 */
function segmentEnd(text: string, from: number, limit: number): number {
	const hardEnd = from + limit;
	if (hardEnd >= text.length) {
		return text.length;
	}
	const newline = text.lastIndexOf('\n', hardEnd - 1);
	if (newline >= from) {
		return newline + 1;
	}
	for (let index = hardEnd - 1; index > from; index -= 1) {
		if (SEGMENT_BREAK_CHARACTERS.has(text.charAt(index))) {
			return index + 1;
		}
	}
	return hardEnd;
}

/**
 * Finds a cut for a partial line that grew too long to hold: at most `limit`,
 * preferring just after a break character within the last segment's width.
 * @param text - The held partial line, literals already redacted.
 * @param limit - Furthest offset the cut may take.
 * @returns The offset to cut at; everything before it may be emitted.
 */
export function partialLineCut(text: string, limit: number): number {
	const from = Math.max(0, limit - REDACT_SEGMENT_CHARS);
	for (let index = limit - 1; index > from; index -= 1) {
		if (SEGMENT_BREAK_CHARACTERS.has(text.charAt(index))) {
			return index + 1;
		}
	}
	return Math.max(0, limit);
}

/**
 * Builds the redactor a job's output runs through. Literal values are replaced
 * across the whole text first, so segmenting never cuts one; whole PEM blocks
 * are replaced before segmenting, so a key's lines never land in two calls.
 * @param values - Literal secret values for the job.
 * @returns The bounded redactor.
 */
export function createOutputRedactor(
	values: readonly string[],
): OutputRedactor {
	const literals = expandRedactValues(values).sort(
		(left, right) => right.length - left.length,
	);
	const redactShapes = createTextRedactor(literals);

	/**
	 * Replaces every literal value with the placeholder.
	 * @param text - Text to scan.
	 * @returns The text without literal secrets.
	 */
	function redactLiterals(text: string): string {
		return literals.reduce(
			(redacted, literal) => redacted.split(literal).join(REDACTED),
			text,
		);
	}

	return {
		literalHoldChars: Math.max(0, (literals[0]?.length ?? 0) - 1),
		redact: (text) => {
			const withoutKeys = PRIVATE_KEY_BLOCK
				? text.replace(PRIVATE_KEY_BLOCK, REDACTED)
				: text;
			if (withoutKeys.length <= REDACT_SEGMENT_CHARS) {
				return redactShapes(withoutKeys);
			}
			const withoutLiterals = redactLiterals(withoutKeys);
			const segments: string[] = [];
			let from = 0;
			while (from < withoutLiterals.length) {
				const end = segmentEnd(withoutLiterals, from, REDACT_SEGMENT_CHARS);
				segments.push(redactShapes(withoutLiterals.slice(from, end)));
				from = end;
			}
			return segments.join('');
		},
		redactLiterals,
	};
}
