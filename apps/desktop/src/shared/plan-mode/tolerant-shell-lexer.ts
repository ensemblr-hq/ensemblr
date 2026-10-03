/**
 * The tolerant sibling of `lexCommand`, for callers that classify what a
 * command runs rather than police what it may touch — the compute queue's
 * heavy-command classifier. It never refuses a construct: redirections and
 * their targets are dropped, comments are skipped, and everything that runs a
 * command of its own is surfaced as a segment to classify.
 *
 * "Everything that runs a command" is the substance. A `$(…)` or backtick
 * substitution runs inside double quotes exactly as outside them, so
 * `out="$(bun run test)"` runs the suite; and a heredoc fed to a shell, as in
 * `bash <<EOF` or `cat <<EOF | sh`, is a script that shell runs. Each segment
 * therefore carries the text fed to its stdin and whether its output is piped
 * onward, so the classifier can follow a document into the shell reading it.
 */
import {
	BLANK,
	createTokenSink,
	LINE_CONTINUATION_LENGTH,
	type Scan,
	SEPARATORS,
	scanDoubleQuoted,
	scanSingleQuoted,
	skipRedirectionBlanks,
	type TokenSink,
} from './shell-lexer.ts';

/** One simple command the tolerant lexer read. */
export interface ShellSegment {
	tokens: readonly string[];
	/** The heredoc body or here-string fed to the command's stdin, or null. */
	stdin: string | null;
	/** Whether the command's output is piped into the segment after it. */
	pipesOnward: boolean;
}

/**
 * Unquoted characters that open or close a nested command — a subshell, or the
 * `(` of a `$(…)` — which the tolerant lexer splits out as a segment of its own.
 */
const NESTING_PARENS: ReadonlySet<string> = new Set(['(', ')']);

/** Bash's group delimiters, which are words to the lexer but name no command. */
const GROUP_TOKENS: ReadonlySet<string> = new Set(['{', '}']);

/** The characters a redirection operator is spelled with: `>`, `2>&1`, `&>>`, `>|`, `<<<`. */
const REDIRECTION_OPERATOR = /[<>&|]/;

/** A pending token that names the descriptor a redirection applies to. */
const FILE_DESCRIPTOR = /^\d+$/;

/** A heredoc delimiter quoted or escaped anywhere, which keeps its body from expanding. */
const QUOTED_DELIMITER = /['"\\]/;

/** A heredoc whose body starts on the next line and runs to its delimiter line. */
interface HeredocMarker {
	delimiter: string;
	stripsTabs: boolean;
	/** Whether substitutions in the body run, as they do under an unquoted delimiter. */
	expands: boolean;
	/** The raw index of the segment whose stdin the body is. */
	segment: number;
}

/** The tolerant walk's state. */
interface TolerantWalk {
	sink: TokenSink;
	heredocs: HeredocMarker[];
	/** How many raw segments have closed, which is the raw index of the open one. */
	closed: number;
	/** Raw indexes of segments whose output is piped onward. */
	pipes: Set<number>;
	/** Text fed to a segment's stdin, by raw index. */
	stdin: Map<number, string>;
	/** The text of every quoted or heredoc substitution, lexed after the walk. */
	substitutions: string[];
}

/**
 * Finds the end of the nested construct starting at an index — a double-quoted
 * run, a backtick substitution, or a `$(…)` — without recording anything.
 * @param source - Text being read.
 * @param index - Index of the `"`, the backtick, or the `$` of a `$(`.
 * @returns Index just past the construct, or null when it never closes.
 */
function nestedEnd(source: string, index: number): number | null {
	if (source[index] === '"') {
		const quoted = scanDoubleQuoted(source, index, (start) =>
			nestedEnd(source, start),
		);
		return 'violation' in quoted ? null : quoted.next;
	}
	return source[index] === '`'
		? backtickEnd(source, index)
		: substitutionEnd(source, index);
}

/**
 * Finds the backtick closing a backtick substitution.
 * @param source - Text being read.
 * @param index - Index of the opening backtick.
 * @returns Index just past the closing backtick, or null when there is none.
 */
function backtickEnd(source: string, index: number): number | null {
	let cursor = index + 1;
	while (cursor < source.length) {
		if (source[cursor] === '\\') {
			cursor += LINE_CONTINUATION_LENGTH;
			continue;
		}
		if (source[cursor] === '`') {
			return cursor + 1;
		}
		cursor += 1;
	}
	return null;
}

/**
 * Finds the parenthesis closing a `$(…)`, honouring the quotes and nested
 * substitutions inside it.
 * @param source - Text being read.
 * @param index - Index of the `$`.
 * @returns Index just past the closing parenthesis, or null when there is none.
 */
function substitutionEnd(source: string, index: number): number | null {
	let depth = 1;
	let cursor = index + 2;
	while (cursor < source.length) {
		const char = source[cursor] as string;
		if (char === '\\') {
			cursor += LINE_CONTINUATION_LENGTH;
			continue;
		}
		if (char === "'") {
			const end = source.indexOf("'", cursor + 1);
			if (end === -1) {
				return null;
			}
			cursor = end + 1;
			continue;
		}
		if (opensNested(source, cursor)) {
			const end = nestedEnd(source, cursor);
			if (end === null) {
				return null;
			}
			cursor = end;
			continue;
		}
		depth += char === '(' ? 1 : char === ')' ? -1 : 0;
		if (depth === 0) {
			return cursor + 1;
		}
		cursor += 1;
	}
	return null;
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
 * Builds the reader that skips a substitution and records the command it runs.
 * @param source - Text being read.
 * @param walk - Walk state the substitution's command is recorded in.
 * @returns A reader answering where the substitution at an index ends, or null when it never closes.
 */
function substitutionReader(
	source: string,
	walk: TolerantWalk,
): (start: number) => number | null {
	return (start) => {
		const end = nestedEnd(source, start);
		if (end !== null) {
			walk.substitutions.push(
				source[start] === '`'
					? source.slice(start + 1, end - 1).replace(/\\([`$\\])/g, '$1')
					: source.slice(start + 2, end - 1),
			);
		}
		return end;
	};
}

/**
 * Records every substitution in an expanding heredoc body, which runs before
 * the document reaches the command reading it.
 * @param body - The heredoc body.
 * @param walk - Walk state the substitutions are recorded in.
 */
function collectSubstitutions(body: string, walk: TolerantWalk): void {
	const read = substitutionReader(body, walk);
	let cursor = 0;
	while (cursor < body.length) {
		const char = body[cursor];
		if (char === '\\') {
			cursor += LINE_CONTINUATION_LENGTH;
		} else if (char === '`' || (char === '$' && body[cursor + 1] === '(')) {
			cursor = read(cursor) ?? body.length;
		} else {
			cursor += 1;
		}
	}
}

/**
 * Closes the open segment, noting whether its output is piped onward.
 * @param walk - Walk state whose open segment closes.
 * @param pipesOnward - Whether a pipe closed it.
 */
function closeSegment(walk: TolerantWalk, pipesOnward: boolean): void {
	if (pipesOnward) {
		walk.pipes.add(walk.closed);
	}
	walk.sink.endSegment();
	walk.closed += 1;
}

/**
 * Reports whether the `|` at an index is a pipe rather than half of an `||`.
 * @param command - Full command text.
 * @param index - Index of the separator.
 * @returns True for a lone `|`.
 */
function isPipe(command: string, index: number): boolean {
	return (
		command[index] === '|' &&
		command[index + 1] !== '|' &&
		command[index - 1] !== '|'
	);
}

/**
 * Measures the nested-command opener at an index — `$(`, `<(`, `>(`, a
 * backtick, or a bare parenthesis.
 * @param command - Full command text.
 * @param index - Index to inspect.
 * @returns The opener's width, or 0 when none starts here.
 */
function nestingOpenerLength(command: string, index: number): number {
	const char = command[index] ?? '';
	if ('$<>'.includes(char) && command[index + 1] === '(') {
		return 2;
	}
	return char === '`' || NESTING_PARENS.has(char) ? 1 : 0;
}

/**
 * Reads a quoted run for the tolerant lexer. A substitution inside a
 * double-quoted run stays literal text of the token, and its command is
 * recorded to be lexed on its own.
 * @param command - Full command text.
 * @param index - Index of the opening quote.
 * @param walk - Walk state substitutions are recorded in.
 * @returns The quoted text and where it ended, or the unbalanced-quote violation.
 */
function scanQuotedTolerantly(
	command: string,
	index: number,
	walk: TolerantWalk,
): Scan {
	return command[index] === "'"
		? scanSingleQuoted(command, index)
		: scanDoubleQuoted(command, index, substitutionReader(command, walk));
}

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
 * @param walk - Walk state substitutions are recorded in.
 * @returns The target and where it ended, or the unbalanced-quote violation.
 */
function scanRedirectionTarget(
	command: string,
	start: number,
	walk: TolerantWalk,
): Scan {
	let text = '';
	let cursor = start;
	while (cursor < command.length) {
		const char = command[cursor] as string;
		if (endsRedirectionTarget(char)) {
			break;
		}
		if (char === "'" || char === '"') {
			const quoted = scanQuotedTolerantly(command, cursor, walk);
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
 * Skips a whole redirection — any descriptor prefix, the operator, and its
 * target — so none of it reaches the segment. A here-string becomes the open
 * segment's stdin, and a heredoc's delimiter is queued so the body on the
 * following lines is read as that stdin rather than as commands.
 * @param command - Full command text.
 * @param index - Index of the operator's first character.
 * @param walk - Walk state holding any descriptor prefix and the heredoc queue.
 * @returns Where to continue, or null on an unbalanced quote in the target.
 */
function skipRedirection(
	command: string,
	index: number,
	walk: TolerantWalk,
): number | null {
	if (FILE_DESCRIPTOR.test(walk.sink.pending() ?? '')) {
		walk.sink.dropPending();
	} else {
		walk.sink.endToken();
	}
	const opensHereString = command.startsWith('<<<', index);
	const opensHeredoc = command.startsWith('<<', index) && !opensHereString;
	let cursor = index;
	while (REDIRECTION_OPERATOR.test(command[cursor] ?? '')) {
		cursor += 1;
	}
	const stripsTabs = opensHeredoc && command[cursor] === '-';
	const targetStart = skipRedirectionBlanks(
		command,
		stripsTabs ? cursor + 1 : cursor,
	);
	const target = scanRedirectionTarget(command, targetStart, walk);
	if ('violation' in target) {
		return null;
	}
	if (opensHeredoc) {
		walk.heredocs.push({
			delimiter: target.text,
			expands: !QUOTED_DELIMITER.test(command.slice(targetStart, target.next)),
			segment: walk.closed,
			stripsTabs,
		});
	}
	if (opensHereString) {
		walk.stdin.set(walk.closed, `${target.text}\n`);
	}
	return target.next;
}

/**
 * Reads one heredoc body: every line up to its delimiter line.
 * @param command - Full command text.
 * @param start - Index of the body's first line.
 * @param marker - The heredoc whose body starts here.
 * @returns The body, and the index just past the delimiter line or the end of input when it never closes.
 */
function readHeredocBody(
	command: string,
	start: number,
	marker: HeredocMarker,
): { body: string; next: number } {
	const lines: string[] = [];
	let cursor = start;
	while (cursor < command.length) {
		const lineEnd = command.indexOf('\n', cursor);
		const next = lineEnd === -1 ? command.length : lineEnd + 1;
		const line = command.slice(cursor, lineEnd === -1 ? undefined : lineEnd);
		const compared = marker.stripsTabs ? line.replace(/^\t+/, '') : line;
		if (compared === marker.delimiter) {
			return { body: lines.join('\n'), next };
		}
		lines.push(compared);
		cursor = next;
	}
	return { body: lines.join('\n'), next: command.length };
}

/**
 * Reads the bodies of every heredoc opened on the line that just ended into
 * the stdin of the segment that opened each, so a document's text is never
 * read as commands of the line it sits under.
 * @param command - Full command text.
 * @param start - Index just past the newline.
 * @param walk - Walk state whose heredoc queue is drained.
 * @returns Where the next command line starts.
 */
function readHeredocBodies(
	command: string,
	start: number,
	walk: TolerantWalk,
): number {
	const next = walk.heredocs.reduce((cursor, marker) => {
		const read = readHeredocBody(command, cursor, marker);
		walk.stdin.set(marker.segment, read.body);
		if (marker.expands) {
			collectSubstitutions(read.body, walk);
		}
		return read.next;
	}, start);
	walk.heredocs = [];
	return next;
}

/**
 * Consumes whatever starts at one index for the tolerant lexer, which turns
 * every construct the strict walk rejects into a boundary instead.
 * @param command - Full command text.
 * @param index - Index to consume from.
 * @param walk - Walk state the step writes through.
 * @returns Where to continue, or null on an unbalanced quote.
 */
function stepTolerant(
	command: string,
	index: number,
	walk: TolerantWalk,
): number | null {
	const { sink } = walk;
	const char = command[index] as string;
	const opener = nestingOpenerLength(command, index);
	if (opener > 0) {
		closeSegment(walk, false);
		return index + opener;
	}
	if (char === "'" || char === '"') {
		const quoted = scanQuotedTolerantly(command, index, walk);
		if ('violation' in quoted) {
			return null;
		}
		sink.push(quoted.text);
		return quoted.next;
	}
	if (char === '\\') {
		if (command[index + 1] !== '\n') {
			sink.push(command[index + 1] ?? '');
		}
		return index + LINE_CONTINUATION_LENGTH;
	}
	if (char === '#' && sink.pending() === null) {
		const lineEnd = command.indexOf('\n', index);
		return lineEnd === -1 ? command.length : lineEnd;
	}
	if (char === '<' || char === '>' || command.startsWith('&>', index)) {
		return skipRedirection(command, index, walk);
	}
	if (SEPARATORS.has(char)) {
		closeSegment(walk, isPipe(command, index));
		return char === '\n'
			? readHeredocBodies(command, index + 1, walk)
			: index + 1;
	}
	if (BLANK.test(char)) {
		sink.endToken();
		return index + 1;
	}
	sink.push(char);
	return index + 1;
}

/**
 * Lexes a bash command into the simple commands it runs, without ever refusing
 * one. The inside of an unquoted `$(…)`, backticks, `<(…)` or a subshell is a
 * segment in its place; a substitution inside double quotes or an expanding
 * heredoc body keeps its literal text in the token and is lexed into segments
 * of its own after the rest. A heredoc body or here-string is the stdin of the
 * segment that opened it, never a command of its own.
 * @param command - The command the agent asked to run.
 * @returns The non-empty segments, or null when an unbalanced quote leaves the command unreadable.
 */
export function lexShellSegments(command: string): ShellSegment[] | null {
	const walk: TolerantWalk = {
		closed: 0,
		heredocs: [],
		pipes: new Set(),
		sink: createTokenSink(),
		stdin: new Map(),
		substitutions: [],
	};
	let index = 0;
	while (index < command.length) {
		const next = stepTolerant(command, index, walk);
		if (next === null) {
			return null;
		}
		index = next;
	}
	const segments = walk.sink
		.finish()
		.map((tokens, rawIndex) => ({
			pipesOnward: walk.pipes.has(rawIndex),
			stdin: walk.stdin.get(rawIndex) ?? null,
			tokens: tokens.filter((token) => !GROUP_TOKENS.has(token)),
		}))
		.filter((segment) => segment.tokens.length > 0);
	const nested = walk.substitutions.flatMap(
		(text) => lexShellSegments(text) ?? [],
	);
	return [...segments, ...nested];
}

/**
 * Lexes a bash command into the argv of every simple command it runs, as
 * {@link lexShellSegments} reads them, without what feeds or follows each.
 * @param command - The command the agent asked to run.
 * @returns The non-empty segments' tokens, or null when an unbalanced quote leaves the command unreadable.
 */
export function lexCommandSegments(command: string): string[][] | null {
	return (
		lexShellSegments(command)?.map((segment) => [...segment.tokens]) ?? null
	);
}
