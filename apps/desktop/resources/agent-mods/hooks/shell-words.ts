/**
 * A best-effort reading of a Bash command line into the simple commands it runs.
 *
 * Not a shell: it knows quotes, backslash escapes, the list and pipe operators,
 * subshell parentheses, command substitution (`$(...)` and backticks, inside
 * double quotes too), and here-documents, which is enough to find every `git` a
 * command would start without mistaking the words of a quoted commit message or
 * a here-document body for one.
 *
 * A substitution's own commands are read as commands of their own; in the word
 * that holds it, the substitution leaves a `$` behind, so whoever reads that
 * word knows it cannot be known without running the shell. A subshell's
 * parentheses, and a substitution's edges, come out as the one-word commands
 * `(` and `)`, so a reader can undo a `cd` made inside one.
 */

/** One quoting context: bare words, or inside single or double quotes. */
type QuoteState = 'bare' | 'double' | 'single';

/** The one-word command that marks a subshell opening. */
export const SUBSHELL_OPEN = '(';

/** The one-word command that marks a subshell closing. */
export const SUBSHELL_CLOSE = ')';

/** Characters that end a simple command when they appear unquoted. */
const LIST_OPERATORS = new Set([';', '&', '|']);

/** Characters that end a here-document delimiter word. */
const DELIMITER_ENDS = /[\s;&|()<>]/;

/** One level of reading: the top-level line, or the inside of a substitution. */
interface Frame {
	closer: ')' | '`' | null;
	current: string[];
	hasWord: boolean;
	quotes: QuoteState[];
	subshells: number;
	word: string;
}

/** A here-document whose body starts at the next unquoted newline. */
interface PendingHeredoc {
	delimiter: string;
	stripsTabs: boolean;
}

/** Everything the reader carries while it walks the line. */
interface Reader {
	commands: string[][];
	frames: Frame[];
	heredocs: PendingHeredoc[];
	index: number;
	line: string;
}

/**
 * Starts a reading level.
 * @param closer - What ends it: `)` or a backtick for a substitution, null for the line.
 * @returns The fresh frame.
 */
function openFrame(closer: Frame['closer']): Frame {
	return {
		closer,
		current: [],
		hasWord: false,
		quotes: ['bare'],
		subshells: 0,
		word: '',
	};
}

/**
 * Closes the word being read, if any, into the frame's command.
 * @param frame - The reading level.
 */
function endWord(frame: Frame): void {
	if (frame.hasWord) {
		frame.current.push(frame.word);
	}
	frame.word = '';
	frame.hasWord = false;
}

/**
 * Closes the frame's command, if it has words, into the reader's commands.
 * @param reader - The reader.
 * @param frame - The reading level.
 */
function endCommand(reader: Reader, frame: Frame): void {
	endWord(frame);
	if (frame.current.length > 0) {
		reader.commands.push(frame.current);
	}
	frame.current = [];
}

/**
 * Appends text to the word being read.
 * @param frame - The reading level.
 * @param text - The text to append.
 */
function append(frame: Frame, text: string): void {
	frame.word += text;
	frame.hasWord = true;
}

/**
 * Opens a substitution: the enclosing word keeps a `$` for it, and its commands
 * are fenced as a subshell, which is where the shell runs them.
 * @param reader - The reader.
 * @param closer - What ends the substitution.
 */
function openSubstitution(reader: Reader, closer: ')' | '`'): void {
	const outer = reader.frames.at(-1);
	if (outer) {
		append(outer, '$');
	}
	reader.commands.push([SUBSHELL_OPEN]);
	reader.frames.push(openFrame(closer));
}

/**
 * Closes the innermost substitution, handing its commands to the reader.
 * @param reader - The reader.
 */
function closeSubstitution(reader: Reader): void {
	const inner = reader.frames.pop();
	if (inner) {
		endCommand(reader, inner);
		reader.commands.push([SUBSHELL_CLOSE]);
	}
}

/**
 * Reads a here-document's delimiter after `<<` or `<<-`, quotes removed.
 * @param reader - The reader, positioned just after `<<`.
 */
function readHeredocOperator(reader: Reader): void {
	const { line } = reader;
	const stripsTabs = line[reader.index] === '-';
	reader.index += stripsTabs ? 1 : 0;
	while (line[reader.index] === ' ' || line[reader.index] === '\t') {
		reader.index += 1;
	}
	let delimiter = '';
	let quote: string | null = null;
	while (reader.index < line.length) {
		const character = line[reader.index] ?? '';
		if (quote === null && DELIMITER_ENDS.test(character)) {
			break;
		}
		reader.index += 1;
		if (quote !== null && character === quote) {
			quote = null;
		} else if (quote === null && (character === "'" || character === '"')) {
			quote = character;
		} else if (character !== '\\') {
			delimiter += character;
		}
	}
	reader.heredocs.push({ delimiter, stripsTabs });
}

/**
 * Skips the bodies of the here-documents opened on the line just ended.
 * @param reader - The reader, positioned at the start of the first body line.
 */
function skipHeredocBodies(reader: Reader): void {
	for (const { delimiter, stripsTabs } of reader.heredocs) {
		while (reader.index < reader.line.length) {
			const newline = reader.line.indexOf('\n', reader.index);
			const end = newline === -1 ? reader.line.length : newline;
			const body = reader.line.slice(reader.index, end);
			reader.index = end + 1;
			if ((stripsTabs ? body.replace(/^\t+/, '') : body) === delimiter) {
				break;
			}
		}
	}
	reader.heredocs = [];
}

/**
 * Reads one character inside single quotes.
 * @param frame - The reading level.
 * @param character - The character.
 */
function readSingleQuoted(frame: Frame, character: string): void {
	if (character === "'") {
		frame.quotes.pop();
	} else {
		append(frame, character);
	}
}

/**
 * Reads one character inside double quotes.
 * @param reader - The reader.
 * @param frame - The reading level.
 * @param character - The character.
 */
function readDoubleQuoted(
	reader: Reader,
	frame: Frame,
	character: string,
): void {
	if (character === '"') {
		frame.quotes.pop();
	} else if (character === '`') {
		openSubstitution(reader, '`');
	} else {
		append(frame, character);
	}
}

/**
 * Reads a parenthesis outside quotes: a subshell's edge, or a substitution's end.
 * @param reader - The reader.
 * @param frame - The reading level.
 * @param character - `(` or `)`.
 */
function readParenthesis(
	reader: Reader,
	frame: Frame,
	character: string,
): void {
	endCommand(reader, frame);
	if (character === '(') {
		frame.subshells += 1;
		reader.commands.push([SUBSHELL_OPEN]);
	} else if (frame.subshells > 0) {
		frame.subshells -= 1;
		reader.commands.push([SUBSHELL_CLOSE]);
	} else if (frame.closer === ')') {
		closeSubstitution(reader);
	}
}

/**
 * Reads one character outside quotes.
 * @param reader - The reader.
 * @param frame - The reading level.
 * @param character - The character.
 */
function readBare(reader: Reader, frame: Frame, character: string): void {
	const { line } = reader;
	if (character === "'" || character === '"') {
		frame.quotes.push(character === "'" ? 'single' : 'double');
		frame.hasWord = true;
	} else if (character === '`') {
		if (frame.closer === '`') {
			closeSubstitution(reader);
		} else {
			openSubstitution(reader, '`');
		}
	} else if (
		character === '<' &&
		line[reader.index] === '<' &&
		line[reader.index + 1] !== '<'
	) {
		reader.index += 1;
		endWord(frame);
		readHeredocOperator(reader);
	} else if (character === '\n') {
		endCommand(reader, frame);
		skipHeredocBodies(reader);
	} else if (LIST_OPERATORS.has(character)) {
		endCommand(reader, frame);
	} else if (character === '(' || character === ')') {
		readParenthesis(reader, frame, character);
	} else if (character === ' ' || character === '\t') {
		endWord(frame);
	} else {
		append(frame, character);
	}
}

/**
 * Splits a command line into its simple commands, each as its unquoted words.
 * @param line - The command line as the model wrote it.
 * @returns Every simple command, substitutions included, in the order each ends.
 */
export function splitCommands(line: string): string[][] {
	const reader: Reader = {
		commands: [],
		frames: [openFrame(null)],
		heredocs: [],
		index: 0,
		line,
	};
	while (reader.index < line.length) {
		const frame = reader.frames.at(-1) ?? openFrame(null);
		const quote = frame.quotes.at(-1) ?? 'bare';
		const character = line[reader.index] ?? '';
		reader.index += 1;
		if (quote === 'single') {
			readSingleQuoted(frame, character);
		} else if (character === '\\') {
			append(frame, line[reader.index] ?? '');
			reader.index += 1;
		} else if (character === '$' && line[reader.index] === '(') {
			reader.index += 1;
			openSubstitution(reader, ')');
		} else if (quote === 'double') {
			readDoubleQuoted(reader, frame, character);
		} else {
			readBare(reader, frame, character);
		}
	}
	while (reader.frames.length > 1) {
		closeSubstitution(reader);
	}
	endCommand(reader, reader.frames[0] ?? openFrame(null));
	return reader.commands;
}
