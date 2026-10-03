/**
 * Finds where the nested constructs of a shell command end — a `$(…)`, a
 * backtick substitution, a double-quoted run, a heredoc — for the tolerant
 * lexer in `tolerant-shell-lexer.ts`.
 *
 * Every reader here is bounded. Nesting deeper than {@link MAX_NESTING_DEPTH},
 * or a scan that has spent its {@link ScanBudget}, answers "does not close", and
 * the caller reads the opener as literal text rather than failing the whole
 * line: a classifier that throws on a deep line, or refuses to read one because
 * a nested quote never closed, lets the heavy command next to it through.
 */
import {
	BLANK,
	LINE_CONTINUATION_LENGTH,
	type Scan,
	SEPARATORS,
	scanDoubleQuoted,
	scanSingleQuoted,
	skipRedirectionBlanks,
} from './shell-lexer.ts';

/** How deep a scan follows nested quotes and substitutions before reading the rest as literal text. */
export const MAX_NESTING_DEPTH = 64;

/** How many characters one lex may spend inside nested constructs before reading the rest as literal text. */
export const MAX_NESTED_SCAN_STEPS = 1_000_000;

/** Reads the substitution starting at an index and answers where it ended, or null when it does not close. */
export type SubstitutionReader = (start: number) => number | null;

/** The work one lex may still spend scanning nested constructs; shared across the whole lex. */
export interface ScanBudget {
	steps: number;
}

/** A heredoc's delimiter, as bash compares it against the lines after the command. */
interface HeredocDelimiter {
	delimiter: string;
	stripsTabs: boolean;
	/** Whether the delimiter was quoted or escaped, which keeps substitutions in the body from running. */
	quoted: boolean;
}

/**
 * Unquoted characters that open or close a nested command — a subshell, or the
 * `(` of a `$(…)`.
 */
export const NESTING_PARENS: ReadonlySet<string> = new Set(['(', ')']);

/** A heredoc delimiter quoted or escaped anywhere, which keeps its body from expanding. */
const QUOTED_DELIMITER = /['"\\]/;

/** Characters after which a `#` opens a comment inside a substitution. */
const COMMENT_PRECEDERS = /[ \t\n;&|(]/;

/**
 * Reports whether a character ends a redirection's target word.
 * @param char - Character to test.
 * @returns True when the target stops before this character.
 */
function endsRedirectionTarget(char: string): boolean {
	return (
		BLANK.test(char) ||
		SEPARATORS.has(char) ||
		char === '<' ||
		char === '>' ||
		NESTING_PARENS.has(char)
	);
}

/**
 * Reads a redirection's target word with its quotes stripped, so the target
 * never reaches a segment and a heredoc delimiter compares as bash compares it.
 * @param command - Full command text.
 * @param start - Index of the target's first character.
 * @param readSubstitution - Reads a substitution inside a double-quoted part of the target.
 * @returns The target and where it ended, or the unbalanced-quote violation.
 */
export function scanRedirectionTarget(
	command: string,
	start: number,
	readSubstitution: SubstitutionReader,
): Scan {
	let text = '';
	let cursor = start;
	while (cursor < command.length) {
		const char = command[cursor] as string;
		if (endsRedirectionTarget(char)) {
			break;
		}
		if (char === "'" || char === '"') {
			const quoted =
				char === "'"
					? scanSingleQuoted(command, cursor)
					: scanDoubleQuoted(command, cursor, readSubstitution);
			if ('violation' in quoted) {
				return quoted;
			}
			text += quoted.text;
			cursor = quoted.next;
			continue;
		}
		const escaped = char === '\\';
		text += escaped ? (command[cursor + 1] ?? '') : char;
		cursor += escaped ? LINE_CONTINUATION_LENGTH : 1;
	}
	return { next: cursor, text };
}

/**
 * Reads the delimiter of the heredoc whose `<<` starts at an index.
 * @param source - Text being read.
 * @param index - Index of the first `<` of a `<<` that is not a `<<<`.
 * @param readSubstitution - Reads a substitution inside a double-quoted delimiter.
 * @returns The delimiter and the index just past it, or null on an unbalanced quote.
 */
export function readHeredocOpener(
	source: string,
	index: number,
	readSubstitution: SubstitutionReader,
): (HeredocDelimiter & { next: number }) | null {
	const operatorEnd = index + 2;
	const stripsTabs = source[operatorEnd] === '-';
	const targetStart = skipRedirectionBlanks(
		source,
		stripsTabs ? operatorEnd + 1 : operatorEnd,
	);
	const target = scanRedirectionTarget(source, targetStart, readSubstitution);
	if ('violation' in target) {
		return null;
	}
	return {
		delimiter: target.text,
		next: target.next,
		quoted: QUOTED_DELIMITER.test(source.slice(targetStart, target.next)),
		stripsTabs,
	};
}

/**
 * Reads one heredoc body: every line up to its delimiter line.
 * @param source - Text being read.
 * @param start - Index of the body's first line.
 * @param marker - The heredoc whose body starts here.
 * @returns The body, and the index just past the delimiter line or the end of input when it never closes.
 */
export function readHeredocBody(
	source: string,
	start: number,
	marker: HeredocDelimiter,
): { body: string; next: number } {
	const lines: string[] = [];
	let cursor = start;
	while (cursor < source.length) {
		const lineEnd = source.indexOf('\n', cursor);
		const next = lineEnd === -1 ? source.length : lineEnd + 1;
		const line = source.slice(cursor, lineEnd === -1 ? undefined : lineEnd);
		const compared = marker.stripsTabs ? line.replace(/^\t+/, '') : line;
		if (compared === marker.delimiter) {
			return { body: lines.join('\n'), next };
		}
		lines.push(compared);
		cursor = next;
	}
	return { body: lines.join('\n'), next: source.length };
}

/**
 * Reports whether a nested construct {@link nestedEnd} reads starts at an index.
 * @param source - Text being read.
 * @param index - Index to inspect.
 * @returns True for a `"`, a backtick, or a `$(`.
 */
function opensNested(source: string, index: number): boolean {
	const char = source[index];
	return (
		char === '"' || char === '`' || (char === '$' && source[index + 1] === '(')
	);
}

/**
 * Finds the end of a double-quoted run without following anything inside it,
 * for a quote found past the nesting cap.
 * @param source - Text being read.
 * @param index - Index of the opening quote.
 * @param budget - The lex's remaining scan budget.
 * @returns Index just past the closing quote, or null when there is none.
 */
function plainQuoteEnd(
	source: string,
	index: number,
	budget: ScanBudget,
): number | null {
	let cursor = index + 1;
	while (cursor < source.length && budget.steps > 0) {
		budget.steps -= 1;
		const char = source[cursor];
		if (char === '"') {
			return cursor + 1;
		}
		cursor += char === '\\' ? LINE_CONTINUATION_LENGTH : 1;
	}
	return null;
}

/**
 * Finds the backtick closing a backtick substitution.
 * @param source - Text being read.
 * @param index - Index of the opening backtick.
 * @param budget - The lex's remaining scan budget.
 * @returns Index just past the closing backtick, or null when there is none.
 */
function backtickEnd(
	source: string,
	index: number,
	budget: ScanBudget,
): number | null {
	let cursor = index + 1;
	while (cursor < source.length && budget.steps > 0) {
		budget.steps -= 1;
		const char = source[cursor];
		if (char === '`') {
			return cursor + 1;
		}
		cursor += char === '\\' ? LINE_CONTINUATION_LENGTH : 1;
	}
	return null;
}

/**
 * Finds the end of the nested construct starting at an index — a double-quoted
 * run, a backtick substitution, or a `$(…)` — without recording anything.
 * @param source - Text being read.
 * @param index - Index of the `"`, the backtick, or the `$` of a `$(`.
 * @param budget - The lex's remaining scan budget.
 * @param depth - How deep this construct sits inside others in the same scan.
 * @returns Index just past the construct, or null when it does not close within the caps.
 */
export function nestedEnd(
	source: string,
	index: number,
	budget: ScanBudget,
	depth = 0,
): number | null {
	const char = source[index];
	const tooDeep = depth >= MAX_NESTING_DEPTH;
	if (char === '`') {
		return backtickEnd(source, index, budget);
	}
	if (char !== '"') {
		return tooDeep ? null : substitutionEnd(source, index, budget, depth);
	}
	if (tooDeep) {
		return plainQuoteEnd(source, index, budget);
	}
	const quoted = scanDoubleQuoted(source, index, (start) =>
		nestedEnd(source, start, budget, depth + 1),
	);
	return 'violation' in quoted ? null : quoted.next;
}

/**
 * Skips a construct inside a substitution that cannot close it: an escape, a
 * single-quoted run, a comment, or a nested quote or substitution. A nested
 * substitution that does not close is literal text, so only its opening
 * character is skipped.
 * @param source - Text being read.
 * @param cursor - Index to inspect.
 * @param budget - The lex's remaining scan budget.
 * @param depth - How deep the enclosing substitution sits.
 * @returns Index past the construct, `cursor` itself when none starts here, or null on an unbalanced quote.
 */
function skipInert(
	source: string,
	cursor: number,
	budget: ScanBudget,
	depth: number,
): number | null {
	const char = source[cursor] as string;
	if (char === '\\') {
		return cursor + LINE_CONTINUATION_LENGTH;
	}
	if (char === "'") {
		const end = source.indexOf("'", cursor + 1);
		return end === -1 ? null : end + 1;
	}
	if (char === '#' && COMMENT_PRECEDERS.test(source[cursor - 1] ?? '')) {
		const lineEnd = source.indexOf('\n', cursor);
		return lineEnd === -1 ? source.length : lineEnd;
	}
	if (!opensNested(source, cursor)) {
		return cursor;
	}
	const end = nestedEnd(source, cursor, budget, depth + 1);
	if (end !== null) {
		return end;
	}
	return char === '"' ? null : cursor + 1;
}

/**
 * Skips the bodies of the heredocs a substitution's line opened.
 * @param source - Text being read.
 * @param start - Index just past the newline that ended the line.
 * @param heredocs - The heredocs opened on it, in order.
 * @returns Index just past the last body.
 */
function skipHeredocBodies(
	source: string,
	start: number,
	heredocs: readonly HeredocDelimiter[],
): number {
	return heredocs.reduce(
		(cursor, marker) => readHeredocBody(source, cursor, marker).next,
		start,
	);
}

/**
 * Finds the parenthesis closing a `$(…)`, honouring the quotes, comments,
 * heredocs and nested substitutions inside it — so an apostrophe in a heredoc
 * body, as in the `git commit -m "$(cat <<'EOF' …)"` form, never reads as an
 * unclosed quote.
 * @param source - Text being read.
 * @param index - Index of the `$`, or of the `<` or `>` of a process substitution.
 * @param budget - The lex's remaining scan budget.
 * @param depth - How deep this substitution sits.
 * @returns Index just past the closing parenthesis, or null when it does not close within the caps.
 */
export function substitutionEnd(
	source: string,
	index: number,
	budget: ScanBudget,
	depth = 0,
): number | null {
	let parens = 1;
	let cursor = index + 2;
	let heredocs: HeredocDelimiter[] = [];
	while (cursor < source.length && budget.steps > 0) {
		budget.steps -= 1;
		const char = source[cursor] as string;
		if (char === '\n' && heredocs.length > 0) {
			cursor = skipHeredocBodies(source, cursor + 1, heredocs);
			heredocs = [];
			continue;
		}
		if (source.startsWith('<<<', cursor)) {
			cursor += 3;
			continue;
		}
		if (source.startsWith('<<', cursor)) {
			const opener = readHeredocOpener(source, cursor, (start) =>
				nestedEnd(source, start, budget, depth + 1),
			);
			if (opener === null) {
				return null;
			}
			heredocs = [...heredocs, opener];
			cursor = opener.next;
			continue;
		}
		const skipped = skipInert(source, cursor, budget, depth);
		if (skipped === null) {
			return null;
		}
		if (skipped > cursor) {
			cursor = skipped;
			continue;
		}
		parens += char === '(' ? 1 : char === ')' ? -1 : 0;
		if (parens === 0) {
			return cursor + 1;
		}
		cursor += 1;
	}
	return null;
}
