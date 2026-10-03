/**
 * Quote-aware lexer for the bash commands Plan Mode classifies. Splitting on
 * whitespace and regex-scanning the raw text got both directions wrong: a quoted
 * path with a space became two tokens and blocked a read-only command, while a
 * plain string replace of `>/dev/null` let `>/dev/nullx` through as a discard and
 * wrote a file. Lexing once, honouring quotes, removes both classes before any
 * classification runs.
 */

/** The command split into its chained segments, or the construct that disqualifies it. */
export interface LexedCommand {
	segments: readonly (readonly string[])[];
	violation: string | null;
}

/** Characters that chain one command into the next when unquoted. */
const SEPARATORS: ReadonlySet<string> = new Set([';', '|', '&', '\n']);

/** File descriptors a redirection may name without creating a file. */
const DISCARDABLE_FDS: ReadonlySet<string> = new Set(['', '1', '2']);

/** The one redirect target that writes nothing. */
const NULL_SINK = '/dev/null';

/**
 * Characters a backslash escapes inside double quotes. Bash keeps the backslash
 * literal before anything else, so `"\w+"` stays `\w+` and a pattern argument
 * survives lexing unchanged.
 *
 * A newline is not here: bash removes `\<newline>` outright rather than
 * unescaping it to a newline, inside double quotes as well as outside. See
 * {@link LINE_CONTINUATION_LENGTH}.
 */
const DOUBLE_QUOTE_ESCAPABLE: ReadonlySet<string> = new Set([
	'"',
	'$',
	'\\',
	'`',
]);

/**
 * Width of a `\<newline>` line continuation, which the walk skips whole.
 *
 * Bash deletes both characters before it words the line, so a continuation
 * contributes nothing at all — not even a boundary. Pushing the newline in as a
 * token instead landed a phantom argument between a head word and its own
 * arguments, and `git \`⏎`status` came back denied as "`git \n status` is not a
 * read-only git subcommand".
 */
const LINE_CONTINUATION_LENGTH = 2;

/**
 * Bash's own blanks, which are space and tab alone.
 *
 * Narrower than JavaScript's `\s`, which additionally matches `\r`, `\v`, `\f`,
 * U+00A0 and the Unicode space separators: bash passes every one of those to the
 * command as part of a word, so splitting on them gave the classifier a view of
 * the command that was provably not the shell's. The `\n` that really does
 * separate is a member of {@link SEPARATORS} and is tested before this.
 */
const BLANK = /[ \t]/;

const REDIRECTION_VIOLATION = 'output redirection `>` can write files';

const UNBALANCED_QUOTE =
	'an unbalanced quote leaves the command impossible to classify';

/** Where the walk continues from, or why the command is disqualified. */
type Step = { next: number } | { violation: string };

/** A scanned stretch of input: its text and where it ended, or why it was rejected. */
type Scan = { next: number; text: string } | { violation: string };

/**
 * Reports whether a character ends an unquoted word.
 * @param char - Character to test, or undefined at end of input.
 * @returns True when the word stops before this character.
 */
function isWordBoundary(char: string | undefined): boolean {
	return (
		char === undefined ||
		BLANK.test(char) ||
		SEPARATORS.has(char) ||
		char === '>' ||
		char === '<' ||
		char === '"' ||
		char === "'"
	);
}

/**
 * Reads the unquoted word starting at an index.
 * @param command - Full command text.
 * @param start - Index of the word's first character.
 * @returns The word, empty when a boundary sits at `start`.
 */
function readWord(command: string, start: number): string {
	let end = start;
	while (!isWordBoundary(command[end])) {
		end += 1;
	}
	return command.slice(start, end);
}

/**
 * Names the command substitution starting at an index, if there is one. Applies
 * inside double quotes as well as outside, because bash expands it in both.
 * @param command - Full command text.
 * @param index - Index to inspect.
 * @returns The violation to report, or null when nothing expands here.
 */
function expansionAt(command: string, index: number): string | null {
	if (command[index] === '`') {
		return 'command substitution with backticks can run other commands';
	}
	if (command[index] === '$' && command[index + 1] === '(') {
		return 'command substitution `$(…)` can run other commands';
	}
	return null;
}

/**
 * Reads a single-quoted run, in which nothing expands or separates.
 * @param command - Full command text.
 * @param index - Index of the opening quote.
 * @returns The quoted text and where it ended, or an unbalanced-quote violation.
 */
function scanSingleQuoted(command: string, index: number): Scan {
	const end = command.indexOf("'", index + 1);
	return end === -1
		? { violation: UNBALANCED_QUOTE }
		: { next: end + 1, text: command.slice(index + 1, end) };
}

/**
 * Reads a double-quoted run, which suppresses separators and redirections but
 * still expands `$(…)` and backticks.
 * @param command - Full command text.
 * @param index - Index of the opening quote.
 * @param keepsExpansions - Whether an expansion is kept as literal text rather than reported, for the tolerant lexer.
 * @returns The quoted text and where it ended, or the violation that stopped it.
 */
function scanDoubleQuoted(
	command: string,
	index: number,
	keepsExpansions = false,
): Scan {
	let text = '';
	let cursor = index + 1;
	while (cursor < command.length) {
		const char = command[cursor] as string;
		if (char === '"') {
			return { next: cursor + 1, text };
		}
		const expansion = keepsExpansions ? null : expansionAt(command, cursor);
		if (expansion) {
			return { violation: expansion };
		}
		const escaped = command[cursor + 1];
		if (char === '\\' && escaped === '\n') {
			cursor += LINE_CONTINUATION_LENGTH;
			continue;
		}
		if (
			char === '\\' &&
			escaped !== undefined &&
			DOUBLE_QUOTE_ESCAPABLE.has(escaped)
		) {
			text += escaped;
			cursor += 2;
			continue;
		}
		text += char;
		cursor += 1;
	}
	return { violation: UNBALANCED_QUOTE };
}

/**
 * Skips the blanks bash allows between a redirection operator and its target, so
 * `> /dev/null` classifies exactly like `>/dev/null`. Newlines are left alone:
 * bash ends the command there rather than continuing to a target.
 * @param command - Full command text.
 * @param index - Index just past the operator.
 * @returns Index of the target's first character.
 */
function skipRedirectionBlanks(command: string, index: number): number {
	let cursor = index;
	while (cursor < command.length && BLANK.test(command[cursor] as string)) {
		cursor += 1;
	}
	return cursor;
}

/**
 * Classifies the redirection starting at a `>`, allowing only the forms that
 * discard output or duplicate a descriptor. Demanding a word boundary after
 * `/dev/null` is what stops `>/dev/nullx` passing as a discard.
 * @param command - Full command text.
 * @param index - Index of the `>`.
 * @returns Where the redirection ended, or why it writes.
 */
function scanRedirection(command: string, index: number): Step {
	const after = command[index + 1];
	if (after === '>') {
		return { violation: 'append redirection `>>` writes a file' };
	}
	if (after === '&') {
		const descriptor = command[index + 2] ?? '';
		const duplicates = descriptor >= '0' && descriptor <= '9';
		return duplicates && isWordBoundary(command[index + 3])
			? { next: index + 3 }
			: { violation: REDIRECTION_VIOLATION };
	}
	const start = skipRedirectionBlanks(command, index + 1);
	const target = readWord(command, start);
	return target === NULL_SINK
		? { next: start + target.length }
		: { violation: REDIRECTION_VIOLATION };
}

/** Accumulates lexed characters into tokens and tokens into chained segments. */
interface TokenSink {
	/** Appends text to the token being built, starting one if there is none. */
	push: (text: string) => void;
	/** The token being built, or null when none is open. */
	pending: () => string | null;
	/** Discards the open token without emitting it. */
	dropPending: () => void;
	/** Emits the open token, if any. */
	endToken: () => void;
	/** Emits the open token and closes the segment. */
	endSegment: () => void;
	/** Closes anything still open and reads the segments out. */
	finish: () => readonly (readonly string[])[];
}

/**
 * Creates the accumulator the walk writes through, so each step function stays a
 * few lines of intent rather than index and buffer bookkeeping.
 * @returns A fresh sink with no tokens or segments.
 */
function createTokenSink(): TokenSink {
	const segments: string[][] = [];
	let tokens: string[] = [];
	let token: string | null = null;

	const endToken = () => {
		if (token !== null) {
			tokens.push(token);
		}
		token = null;
	};
	const endSegment = () => {
		endToken();
		segments.push(tokens);
		tokens = [];
	};
	return {
		dropPending: () => {
			token = null;
		},
		endSegment,
		endToken,
		finish: () => {
			if (token !== null || tokens.length > 0) {
				endSegment();
			}
			return segments;
		},
		pending: () => token,
		push: (text) => {
			token = (token ?? '') + text;
		},
	};
}

/**
 * Consumes a quoted run into the open token.
 * @param command - Full command text.
 * @param index - Index of the opening quote.
 * @param sink - Accumulator to write the quoted text into.
 * @returns Where to continue, or the violation the quote contained.
 */
function stepQuoted(command: string, index: number, sink: TokenSink): Step {
	const quoted =
		command[index] === "'"
			? scanSingleQuoted(command, index)
			: scanDoubleQuoted(command, index);
	if ('violation' in quoted) {
		return quoted;
	}
	sink.push(quoted.text);
	return { next: quoted.next };
}

/**
 * Consumes a `<`, which opens a process substitution, a heredoc, or a plain
 * input redirection that only reads.
 * @param command - Full command text.
 * @param index - Index of the `<`.
 * @param sink - Accumulator whose open token the `<` ends.
 * @returns Where to continue, or the violation the construct is.
 */
function stepInput(command: string, index: number, sink: TokenSink): Step {
	const opener = command[index + 1];
	if (opener === '(') {
		return { violation: 'process substitution `<(…)` can run other commands' };
	}
	if (opener === '<') {
		return { violation: 'heredoc input `<<` can write files' };
	}
	sink.endToken();
	return { next: index + 1 };
}

/**
 * Consumes an output redirection, either `>` with an optional descriptor prefix
 * already in the open token or the `&>` that redirects both streams. A pending
 * token that is not a descriptor is a filename, which means the command writes.
 * @param command - Full command text.
 * @param index - Index of the `>` or the `&` of an `&>`.
 * @param sink - Accumulator holding any descriptor prefix.
 * @returns Where to continue, or why the redirection writes.
 */
function stepRedirection(
	command: string,
	index: number,
	sink: TokenSink,
): Step {
	if (command[index] === '>') {
		if (!DISCARDABLE_FDS.has(sink.pending() ?? '')) {
			return { violation: REDIRECTION_VIOLATION };
		}
		sink.dropPending();
		return scanRedirection(command, index);
	}
	sink.endToken();
	return scanRedirection(command, index + 1);
}

/**
 * Consumes whatever starts at one index of the command.
 * @param command - Full command text.
 * @param index - Index to consume from.
 * @param sink - Accumulator the step writes through.
 * @returns Where to continue, or the violation that ends the matter.
 */
function step(command: string, index: number, sink: TokenSink): Step {
	const char = command[index] as string;
	const expansion = expansionAt(command, index);
	if (expansion) {
		return { violation: expansion };
	}
	if (char === "'" || char === '"') {
		return stepQuoted(command, index, sink);
	}
	if (char === '\\') {
		if (command[index + 1] === '\n') {
			return { next: index + LINE_CONTINUATION_LENGTH };
		}
		sink.push(command[index + 1] ?? '');
		return { next: index + LINE_CONTINUATION_LENGTH };
	}
	if (char === '<') {
		return stepInput(command, index, sink);
	}
	if (char === '>' || (char === '&' && command[index + 1] === '>')) {
		return stepRedirection(command, index, sink);
	}
	if (SEPARATORS.has(char)) {
		sink.endSegment();
		return { next: index + 1 };
	}
	if (BLANK.test(char)) {
		sink.endToken();
		return { next: index + 1 };
	}
	sink.push(char);
	return { next: index + 1 };
}

/**
 * Lexes a bash command into its chained segments, each a list of quote-stripped
 * tokens, rejecting the constructs that reach past the commands it names.
 * @param command - The command the agent asked to run.
 * @returns The segments to classify, or the violation that ends the matter.
 */
export function lexCommand(command: string): LexedCommand {
	const sink = createTokenSink();
	let index = 0;
	while (index < command.length) {
		const consumed = step(command, index, sink);
		if ('violation' in consumed) {
			return { segments: [], violation: consumed.violation };
		}
		index = consumed.next;
	}
	return { segments: sink.finish(), violation: null };
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

/** A heredoc whose body starts on the next line and runs to its delimiter line. */
interface HeredocMarker {
	delimiter: string;
	stripsTabs: boolean;
}

/** The tolerant walk's state: the token accumulator and the heredocs awaiting a body. */
interface TolerantWalk {
	sink: TokenSink;
	heredocs: HeredocMarker[];
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
 * Reads a quoted run for the tolerant lexer, keeping any expansion inside a
 * double-quoted run as literal text.
 * @param command - Full command text.
 * @param index - Index of the opening quote.
 * @returns The quoted text and where it ended, or the unbalanced-quote violation.
 */
function scanQuotedTolerantly(command: string, index: number): Scan {
	return command[index] === "'"
		? scanSingleQuoted(command, index)
		: scanDoubleQuoted(command, index, true);
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
 * @returns The target and where it ended, or the unbalanced-quote violation.
 */
function scanRedirectionTarget(command: string, start: number): Scan {
	let text = '';
	let cursor = start;
	while (cursor < command.length) {
		const char = command[cursor] as string;
		if (endsRedirectionTarget(char)) {
			break;
		}
		if (char === "'" || char === '"') {
			const quoted = scanQuotedTolerantly(command, cursor);
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
 * target — so none of it reaches the segment. A heredoc's delimiter is queued
 * so the body on the following lines is skipped too.
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
	const opensHeredoc =
		command.startsWith('<<', index) && command[index + 2] !== '<';
	let cursor = index;
	while (REDIRECTION_OPERATOR.test(command[cursor] ?? '')) {
		cursor += 1;
	}
	const stripsTabs = opensHeredoc && command[cursor] === '-';
	const target = scanRedirectionTarget(
		command,
		skipRedirectionBlanks(command, stripsTabs ? cursor + 1 : cursor),
	);
	if ('violation' in target) {
		return null;
	}
	if (opensHeredoc) {
		walk.heredocs.push({ delimiter: target.text, stripsTabs });
	}
	return target.next;
}

/**
 * Skips one heredoc body: every line up to and including its delimiter line.
 * @param command - Full command text.
 * @param start - Index of the body's first line.
 * @param marker - The heredoc whose body starts here.
 * @returns Index just past the delimiter line, or the end of input when it never closes.
 */
function skipHeredocBody(
	command: string,
	start: number,
	marker: HeredocMarker,
): number {
	let cursor = start;
	while (cursor < command.length) {
		const lineEnd = command.indexOf('\n', cursor);
		const next = lineEnd === -1 ? command.length : lineEnd + 1;
		const line = command.slice(cursor, lineEnd === -1 ? undefined : lineEnd);
		const compared = marker.stripsTabs ? line.replace(/^\t+/, '') : line;
		if (compared === marker.delimiter) {
			return next;
		}
		cursor = next;
	}
	return command.length;
}

/**
 * Skips the bodies of every heredoc opened on the line that just ended, so a
 * document's text is never read as commands.
 * @param command - Full command text.
 * @param start - Index just past the newline.
 * @param walk - Walk state whose heredoc queue is drained.
 * @returns Where the next command line starts.
 */
function skipHeredocBodies(
	command: string,
	start: number,
	walk: TolerantWalk,
): number {
	const next = walk.heredocs.reduce(
		(cursor, marker) => skipHeredocBody(command, cursor, marker),
		start,
	);
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
		sink.endSegment();
		return index + opener;
	}
	if (char === "'" || char === '"') {
		const quoted = scanQuotedTolerantly(command, index);
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
		sink.endSegment();
		return char === '\n'
			? skipHeredocBodies(command, index + 1, walk)
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
 * Lexes a bash command into the simple commands it runs, each a list of
 * quote-stripped tokens, without ever refusing one.
 *
 * The tolerant sibling of {@link lexCommand}, for callers that classify what a
 * command runs rather than police what it may touch: redirections and their
 * targets are dropped, heredoc bodies and comments are skipped, and the inside
 * of `$(…)`, backticks, `<(…)` and a subshell becomes a segment of its own. An
 * expansion inside double quotes stays literal text of the token it sits in.
 * @param command - The command the agent asked to run.
 * @returns The non-empty segments, or null when an unbalanced quote leaves the command unreadable.
 */
export function lexCommandSegments(command: string): string[][] | null {
	const walk: TolerantWalk = { heredocs: [], sink: createTokenSink() };
	let index = 0;
	while (index < command.length) {
		const next = stepTolerant(command, index, walk);
		if (next === null) {
			return null;
		}
		index = next;
	}
	return walk.sink
		.finish()
		.map((segment) => segment.filter((token) => !GROUP_TOKENS.has(token)))
		.filter((segment) => segment.length > 0);
}
