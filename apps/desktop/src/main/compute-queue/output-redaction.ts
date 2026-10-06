import {
	createTextRedactor,
	lineLiteral,
	MINIMUM_VALUE_LENGTH,
	REDACTED,
} from '../../shared/redaction.ts';

/** Opening armor line of a PEM private key. */
const PRIVATE_KEY_BEGIN = /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g;

/** Closing armor line of a PEM private key. */
const PRIVATE_KEY_END = /-----END (?:[A-Z]+ )?PRIVATE KEY-----/;

/** Cheap substring every opening armor line contains. */
const PRIVATE_KEY_BEGIN_PREFIX = '-----BEGIN ';

/**
 * Characters a partial line may be cut just after: whitespace only. A `,` or
 * `;` can sit inside URL userinfo or an ANSI escape, so neither ends a token.
 */
const CUT_AFTER_CHARACTERS = /\s/;

/** Characters an assignment or quoted value hangs on, never cut beside. */
const CUT_FORBIDDEN_NEIGHBOURS = new Set(['=', ':', '"', "'", '`']);

/** Redaction for one job's output stream. */
export interface OutputRedactor {
	/** Characters a cut must keep back so no literal straddles it. */
	literalHoldChars: number;
	/** Redacts finished text: literal values, then every secret shape. */
	redact: (text: string) => string;
	/** Replaces only the literal secret values, in one linear pass. */
	redactLiterals: (text: string) => string;
}

/** Where a partial line that outgrew its bound is cut. */
export interface PartialLineCut {
	/** True when the cut masked a token that runs on past the held text. */
	dropping: boolean;
	/** Text to emit now. */
	emit: string;
	/** Text that stays held. */
	keep: string;
}

/**
 * Adds the distinctive lines of every multi-line secret as literals of their
 * own, so a value whose lines arrive in different pipe chunks is still
 * redacted line by line.
 * @param values - Literal secret values as the environment holds them.
 * @returns The values plus the distinctive lines of the multi-line ones.
 */
export function expandRedactValues(values: readonly string[]): string[] {
	const expanded = new Set<string>(values);
	for (const value of values) {
		if (!value.includes('\n')) {
			continue;
		}
		for (const line of value.split(/\r?\n/)) {
			const literal = lineLiteral(line);
			if (literal !== null) {
				expanded.add(literal);
			}
		}
	}
	return Array.from(expanded).filter(
		(value) => value.length >= MINIMUM_VALUE_LENGTH,
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
 * Reports whether a cut just before `index` is safe: whitespace ends the token
 * before it, `index` starts one, and neither the nearest visible character on
 * the left nor the one on the right is a separator or quote an assignment
 * hangs on. No single-line shape the redactor knows contains whitespace
 * except around an assignment's separator, which that rule excludes.
 * @param text - The held text, ANSI already stripped.
 * @param index - Candidate cut offset.
 * @returns True when the cut falls between two whitespace-separated tokens.
 */
function isSafeCut(text: string, index: number): boolean {
	const right = text.charAt(index);
	if (
		!CUT_AFTER_CHARACTERS.test(text.charAt(index - 1)) ||
		/\s/.test(right) ||
		CUT_FORBIDDEN_NEIGHBOURS.has(right)
	) {
		return false;
	}
	let left = index - 1;
	while (left > 0 && /\s/.test(text.charAt(left))) {
		left -= 1;
	}
	return !CUT_FORBIDDEN_NEIGHBOURS.has(text.charAt(left));
}

/**
 * Cuts a partial line that outgrew its bound, at or before `limit`. It prefers
 * a safe whitespace boundary; failing one, it masks the whole
 * whitespace-delimited token that straddles `limit`, reporting when that token
 * runs on past the held text so the caller drops its remainder too.
 * @param text - The held partial line, ANSI stripped and literals redacted.
 * @param limit - Furthest offset the cut may take.
 * @returns What to emit, what to keep, and whether to keep dropping.
 */
export function cutPartialLine(text: string, limit: number): PartialLineCut {
	for (let index = Math.min(limit, text.length - 1); index > 0; index -= 1) {
		if (isSafeCut(text, index)) {
			return {
				dropping: false,
				emit: text.slice(0, index),
				keep: text.slice(index),
			};
		}
	}
	let tokenStart = Math.max(0, limit);
	while (
		tokenStart > 0 &&
		!CUT_AFTER_CHARACTERS.test(text.charAt(tokenStart - 1))
	) {
		tokenStart -= 1;
	}
	const tokenEnd = text.slice(limit).search(CUT_AFTER_CHARACTERS);
	const masked = `${text.slice(0, tokenStart)}${REDACTED}`;
	return tokenEnd === -1
		? { dropping: true, emit: masked, keep: '' }
		: { dropping: false, emit: masked, keep: text.slice(limit + tokenEnd) };
}

/**
 * Builds the redactor a job's output runs through: the shared redactor over
 * the expanded literals. Every pattern it runs is linear-time, so a whole line
 * is redacted in one call; only a line too long to hold is cut, and then only
 * at whitespace (see {@link cutPartialLine}).
 * @param values - Literal secret values for the job.
 * @returns The redactor.
 */
export function createOutputRedactor(
	values: readonly string[],
): OutputRedactor {
	const literals = expandRedactValues(values).sort(
		(left, right) => right.length - left.length,
	);

	return {
		literalHoldChars: Math.max(0, (literals[0]?.length ?? 0) - 1),
		redact: createTextRedactor(literals),
		redactLiterals: (text) =>
			literals.reduce(
				(redacted, literal) => redacted.split(literal).join(REDACTED),
				text,
			),
	};
}
