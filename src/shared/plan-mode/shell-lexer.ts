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
 */
const DOUBLE_QUOTE_ESCAPABLE: ReadonlySet<string> = new Set([
	'"',
	'$',
	'\\',
	'`',
	'\n',
]);

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
		/\s/.test(char) ||
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
 * @returns The quoted text and where it ended, or the violation that stopped it.
 */
function scanDoubleQuoted(command: string, index: number): Scan {
	let text = '';
	let cursor = index + 1;
	while (cursor < command.length) {
		const char = command[cursor] as string;
		if (char === '"') {
			return { next: cursor + 1, text };
		}
		const expansion = expansionAt(command, cursor);
		if (expansion) {
			return { violation: expansion };
		}
		const escaped = command[cursor + 1];
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
	while (cursor < command.length && /[ \t]/.test(command[cursor] as string)) {
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
		sink.push(command[index + 1] ?? '');
		return { next: index + 2 };
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
	if (/\s/.test(char)) {
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
