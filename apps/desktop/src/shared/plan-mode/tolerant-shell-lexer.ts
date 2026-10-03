/**
 * The tolerant sibling of `lexCommand`, for callers that classify what a
 * command runs rather than police what it may touch — the compute queue's
 * heavy-command classifier. It never refuses a construct: redirections and
 * their targets are dropped, comments are skipped, and everything that runs a
 * command of its own is surfaced as a segment to classify.
 *
 * "Everything that runs a command" is the substance. A `$(…)` or backtick
 * substitution runs inside double quotes exactly as outside them, so
 * `out="$(bun run test)"` runs the suite; a heredoc fed to a shell, as in
 * `bash <<EOF` or `cat <<EOF | sh`, is a script that shell runs; and so is the
 * output of a process substitution a shell sources, as in `bash <(…)`. Each
 * segment therefore carries the text fed to its stdin, the process
 * substitutions among its arguments, and whether its output is piped onward,
 * so the classifier can follow a script into the shell reading it.
 *
 * The work is bounded: nested text past {@link MAX_NESTING_DEPTH} levels or
 * {@link MAX_NESTED_LEX_CHARS} characters is left as literal text rather than
 * lexed, so no input can exhaust the stack or stall the main process.
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
import {
	MAX_NESTED_SCAN_STEPS,
	MAX_NESTING_DEPTH,
	NESTING_PARENS,
	nestedEnd,
	readHeredocBody,
	readHeredocOpener,
	type ScanBudget,
	type SubstitutionReader,
	scanRedirectionTarget,
	substitutionEnd,
} from './shell-substitution-scan.ts';

/** One simple command the tolerant lexer read. */
export interface ShellSegment {
	tokens: readonly string[];
	/** The heredoc body or here-string fed to the command's stdin, or null. */
	stdin: string | null;
	/** The command text of each `<(…)` or `>(…)` among the command's arguments. */
	processInputs: readonly string[];
	/** Whether the command's output is piped into the segment after it. */
	pipesOnward: boolean;
}

/** How many characters of substitution text one lex reads into segments before leaving the rest literal. */
const MAX_NESTED_LEX_CHARS = 64 * 1024;

/** Bash's group delimiters, which are words to the lexer but name no command. */
const GROUP_TOKENS: ReadonlySet<string> = new Set(['{', '}']);

/** The characters a redirection operator is spelled with: `>`, `2>&1`, `&>>`, `>|`, `<<<`. */
const REDIRECTION_OPERATOR = /[<>&|]/;

/** A pending token that names the descriptor a redirection applies to. */
const FILE_DESCRIPTOR = /^\d+$/;

/** The work one lex may still spend, shared by every nested lex it starts. */
interface LexBudget extends ScanBudget {
	nestedChars: number;
}

/** A heredoc whose body starts on the next line and runs to its delimiter line. */
interface HeredocMarker {
	delimiter: string;
	stripsTabs: boolean;
	quoted: boolean;
	/** The raw index of the segment whose stdin the body is. */
	segment: number;
}

/** The tolerant walk's state. */
interface TolerantWalk {
	sink: TokenSink;
	budget: LexBudget;
	heredocs: HeredocMarker[];
	/** How many raw segments have closed, which is the raw index of the open one. */
	closed: number;
	/** Raw indexes of segments whose output is piped onward. */
	pipes: Set<number>;
	/** Text fed to a segment's stdin, by raw index. */
	stdin: Map<number, string>;
	/** Process-substitution text among a segment's arguments, by raw index. */
	processInputs: Map<number, readonly string[]>;
	/** The text of every substitution lexed after the walk rather than in place. */
	substitutions: string[];
}

/**
 * Builds the reader that skips a substitution and records the command it runs.
 * @param source - Text being read.
 * @param walk - Walk state the substitution's command is recorded in.
 * @returns A reader answering where the substitution at an index ends, or null when it does not close.
 */
function substitutionReader(
	source: string,
	walk: TolerantWalk,
): SubstitutionReader {
	return (start) => {
		const end = nestedEnd(source, start, walk.budget);
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
			cursor = read(cursor) ?? cursor + 1;
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
 * Reads a `<(…)` or `>(…)` whole: its command is lexed after the walk, and
 * noted among the open segment's process inputs, since a shell or `source`
 * handed one runs what it prints.
 * @param command - Full command text.
 * @param index - Index of the `<` or `>`.
 * @param walk - Walk state the process substitution is recorded in.
 * @returns Where to continue, or null when it does not close and is read in place instead.
 */
function stepProcessSubstitution(
	command: string,
	index: number,
	walk: TolerantWalk,
): number | null {
	const end = substitutionEnd(command, index, walk.budget);
	if (end === null) {
		return null;
	}
	const text = command.slice(index + 2, end - 1);
	walk.sink.endToken();
	walk.substitutions.push(text);
	walk.processInputs.set(walk.closed, [
		...(walk.processInputs.get(walk.closed) ?? []),
		text,
	]);
	return end;
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
 * Queues the heredoc whose `<<` starts at an index, so its body on the
 * following lines is read as the open segment's stdin.
 * @param command - Full command text.
 * @param index - Index of the first `<`.
 * @param walk - Walk state holding the heredoc queue.
 * @returns Where to continue, or null on an unbalanced quote in the delimiter.
 */
function queueHeredoc(
	command: string,
	index: number,
	walk: TolerantWalk,
): number | null {
	const opener = readHeredocOpener(
		command,
		index,
		substitutionReader(command, walk),
	);
	if (opener === null) {
		return null;
	}
	walk.heredocs.push({
		delimiter: opener.delimiter,
		quoted: opener.quoted,
		segment: walk.closed,
		stripsTabs: opener.stripsTabs,
	});
	return opener.next;
}

/**
 * Skips a whole redirection — any descriptor prefix, the operator, and its
 * target — so none of it reaches the segment. A here-string becomes the open
 * segment's stdin, and a heredoc's body becomes it once its lines arrive.
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
	if (command.startsWith('<<', index) && !opensHereString) {
		return queueHeredoc(command, index, walk);
	}
	let cursor = index;
	while (REDIRECTION_OPERATOR.test(command[cursor] ?? '')) {
		cursor += 1;
	}
	const target = scanRedirectionTarget(
		command,
		skipRedirectionBlanks(command, cursor),
		substitutionReader(command, walk),
	);
	if ('violation' in target) {
		return null;
	}
	if (opensHereString) {
		walk.stdin.set(walk.closed, `${target.text}\n`);
	}
	return target.next;
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
		if (!marker.quoted) {
			collectSubstitutions(read.body, walk);
		}
		return read.next;
	}, start);
	walk.heredocs = [];
	return next;
}

/**
 * Consumes a word character, a quote, an escape, or a comment.
 * @param command - Full command text.
 * @param index - Index to consume from.
 * @param walk - Walk state the step writes through.
 * @returns Where to continue, or null on an unbalanced quote.
 */
function stepWord(
	command: string,
	index: number,
	walk: TolerantWalk,
): number | null {
	const { sink } = walk;
	const char = command[index] as string;
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
	sink.push(char);
	return index + 1;
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
	const char = command[index] as string;
	const opensProcess =
		(char === '<' || char === '>') && command[index + 1] === '(';
	const processEnd = opensProcess
		? stepProcessSubstitution(command, index, walk)
		: null;
	if (processEnd !== null) {
		return processEnd;
	}
	const opener = nestingOpenerLength(command, index);
	if (opener > 0) {
		closeSegment(walk, false);
		return index + opener;
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
		walk.sink.endToken();
		return index + 1;
	}
	return stepWord(command, index, walk);
}

/**
 * Reads the walk's segments out, dropping group braces and empty segments.
 * @param walk - The finished walk.
 * @returns The segments in command order.
 */
function segmentsOf(walk: TolerantWalk): ShellSegment[] {
	return walk.sink
		.finish()
		.map((tokens, rawIndex) => ({
			pipesOnward: walk.pipes.has(rawIndex),
			processInputs: walk.processInputs.get(rawIndex) ?? [],
			stdin: walk.stdin.get(rawIndex) ?? null,
			tokens: tokens.filter((token) => !GROUP_TOKENS.has(token)),
		}))
		.filter((segment) => segment.tokens.length > 0);
}

/**
 * Lexes the substitutions a walk recorded, within what the budget has left.
 * @param texts - The substitutions' command text.
 * @param depth - How deep the walk that recorded them sits.
 * @param budget - The work the whole lex may still spend.
 * @returns Their segments, in the order they were recorded.
 */
function lexNested(
	texts: readonly string[],
	depth: number,
	budget: LexBudget,
): ShellSegment[] {
	if (depth >= MAX_NESTING_DEPTH) {
		return [];
	}
	return texts.flatMap((text) => {
		if (text.length > budget.nestedChars) {
			return [];
		}
		budget.nestedChars -= text.length;
		return lexWithin(text, depth + 1, budget) ?? [];
	});
}

/**
 * Lexes one command line, and then the substitutions inside it.
 * @param command - The command line.
 * @param depth - How many substitutions deep it sits.
 * @param budget - The work the whole lex may still spend.
 * @returns The segments, or null when an unbalanced quote leaves the line unreadable.
 */
function lexWithin(
	command: string,
	depth: number,
	budget: LexBudget,
): ShellSegment[] | null {
	const walk: TolerantWalk = {
		budget,
		closed: 0,
		heredocs: [],
		pipes: new Set(),
		processInputs: new Map(),
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
	return [...segmentsOf(walk), ...lexNested(walk.substitutions, depth, budget)];
}

/**
 * Lexes a bash command into the simple commands it runs, without ever refusing
 * one. The inside of an unquoted `$(…)`, backticks or a subshell is a segment
 * in its place; a substitution inside double quotes, a process substitution,
 * or a substitution in an expanding heredoc body is lexed into segments of its
 * own after the rest. A heredoc body or here-string is the stdin of the
 * segment that opened it, never a command of its own.
 * @param command - The command the agent asked to run.
 * @returns The non-empty segments, or null when an unbalanced quote leaves the command unreadable.
 */
export function lexShellSegments(command: string): ShellSegment[] | null {
	return lexWithin(command, 0, {
		nestedChars: MAX_NESTED_LEX_CHARS,
		steps: MAX_NESTED_SCAN_STEPS,
	});
}
