/**
 * A best-effort reading of a Bash command line into the simple commands it runs.
 *
 * Not a shell: it knows quotes, backslash escapes, the list and pipe operators,
 * subshell parentheses, and command substitution (`$(...)` and backticks, inside
 * double quotes too), which is enough to find every `git` a command would start
 * without mistaking the words of a quoted commit message for one.
 */

/** One quoting context: bare words, or inside single or double quotes. */
type QuoteState = 'bare' | 'double' | 'single';

/** Characters that end a simple command when they appear unquoted. */
const COMMAND_SEPARATORS = new Set([';', '&', '|', '\n', '(', ')', '`']);

/** Accumulates words and commands while the lexer walks the line. */
interface LexerState {
	commands: string[][];
	current: string[];
	hasWord: boolean;
	word: string;
}

/**
 * Closes the word being read, if any, into the current command.
 * @param state - The lexer state.
 */
function endWord(state: LexerState): void {
	if (state.hasWord) {
		state.current.push(state.word);
	}
	state.word = '';
	state.hasWord = false;
}

/**
 * Closes the current command, if it has words, and starts the next one.
 * @param state - The lexer state.
 */
function endCommand(state: LexerState): void {
	endWord(state);
	if (state.current.length > 0) {
		state.commands.push(state.current);
	}
	state.current = [];
}

/**
 * Appends one character to the word being read.
 * @param state - The lexer state.
 * @param character - The character to append.
 */
function appendCharacter(state: LexerState, character: string): void {
	state.word += character;
	state.hasWord = true;
}

/**
 * Splits a command line into its simple commands, each as its unquoted words.
 * @param line - The command line as the model wrote it.
 * @returns Every simple command, substitutions included, in reading order.
 */
export function splitCommands(line: string): string[][] {
	const state: LexerState = {
		commands: [],
		current: [],
		hasWord: false,
		word: '',
	};
	const quotes: QuoteState[] = ['bare'];
	let index = 0;
	while (index < line.length) {
		const character = line[index] ?? '';
		const quote = quotes.at(-1) ?? 'bare';
		index += 1;
		if (quote === 'single') {
			if (character === "'") {
				quotes.pop();
			} else {
				appendCharacter(state, character);
			}
			continue;
		}
		if (character === '\\') {
			appendCharacter(state, line[index] ?? '');
			index += 1;
			continue;
		}
		if (character === '$' && line[index] === '(') {
			index += 1;
			quotes.push('bare');
			endCommand(state);
			continue;
		}
		if (quote === 'double') {
			if (character === '"') {
				quotes.pop();
			} else if (character === '`') {
				quotes.push('bare');
				endCommand(state);
			} else {
				appendCharacter(state, character);
			}
			continue;
		}
		if (character === "'") {
			quotes.push('single');
			state.hasWord = true;
		} else if (character === '"') {
			quotes.push('double');
			state.hasWord = true;
		} else if (COMMAND_SEPARATORS.has(character)) {
			if ((character === ')' || character === '`') && quotes.length > 1) {
				quotes.pop();
			}
			endCommand(state);
		} else if (character === ' ' || character === '\t') {
			endWord(state);
		} else {
			appendCharacter(state, character);
		}
	}
	endCommand(state);
	return state.commands;
}
