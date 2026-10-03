/**
 * Finds the commands one simple command runs inside itself, for the
 * heavy-command classifier: a shell's `-c` string or the script it reads from
 * stdin or a process substitution, a Nix shell's command, `eval`'s arguments,
 * `watch`'s command, and each `find -exec`.
 *
 * Two indirections are deliberately not followed, because reading them would
 * mean evaluating the shell rather than lexing it: a variable holding a command
 * (`T=vitest; $T run`), and a script that reaches a shell through a filter
 * (`echo … | tee /dev/null | sh`).
 */
import { lexShellSegments, type ShellSegment } from '../plan-mode.ts';
import {
	normaliseTokens,
	skipOptions,
	type Tokens,
} from './command-normaliser.ts';

/** A command another command runs: a string to lex, or an argv to classify as-is. */
type NestedCommand = { text: string } | { argv: Tokens };

/** What one segment is fed: its stdin, and the scripts its process substitutions print. */
export interface SegmentFeed {
	stdin: string | null;
	processScripts: readonly string[];
}

/** A segment fed nothing the classifier can see. */
export const NO_FEED: SegmentFeed = { processScripts: [], stdin: null };

/** How much of a script fed to a shell is classified; the rest is left unread. */
const MAX_FED_SCRIPT_CHARS = 64 * 1024;

/** A shell option cluster that carries `-c`, as in `-c`, `-lc`, `-ec`. */
const SHELL_COMMAND_FLAG = /^-[A-Za-z]*c[A-Za-z]*$/;

/** A shell option cluster that carries `-s`, which reads the script from stdin. */
const STDIN_SCRIPT_FLAG = /^-[A-Za-z]*s[A-Za-z]*$/;

/** `echo`'s own options, which it does not print. */
const ECHO_FLAGS = /^-[neE]+$/;

/** Shells whose `-c` argument, stdin, or script operand is itself a command line. */
const SHELLS: ReadonlySet<string> = new Set([
	'bash',
	'dash',
	'fish',
	'ksh',
	'sh',
	'zsh',
]);

/** Builtins that run a script file in the current shell. */
const SOURCERS: ReadonlySet<string> = new Set(['.', 'source']);

/** Shell options that consume the next word, which is therefore not a script. */
const SHELL_VALUE_FLAGS: ReadonlySet<string> = new Set([
	'+O',
	'+o',
	'-O',
	'-o',
	'--init-file',
	'--rcfile',
]);

/** `watch`'s options that take a value. */
const WATCH_VALUE_FLAGS: ReadonlySet<string> = new Set([
	'-n',
	'--interval',
	'-q',
	'--equexit',
]);

/** `find` actions that run a command, which runs up to a `;` or `+`. */
const FIND_EXEC_ACTIONS: ReadonlySet<string> = new Set([
	'-exec',
	'-execdir',
	'-ok',
	'-okdir',
]);

/** The words that end a `find -exec` command. */
const FIND_EXEC_TERMINATORS: ReadonlySet<string> = new Set([';', '+']);

/**
 * Finds the command string a shell's `-c` option runs.
 * @param rest - The shell's argv.
 * @returns The command string, or null when the shell runs a script or nothing.
 */
function shellCommandString(rest: Tokens): string | null {
	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index] as string;
		if (SHELL_COMMAND_FLAG.test(token) || token === '--command') {
			return rest[index + 1] ?? null;
		}
		if (SHELL_VALUE_FLAGS.has(token)) {
			index += 1;
			continue;
		}
		if (!token.startsWith('-') && !token.startsWith('+')) {
			return null;
		}
	}
	return null;
}

/**
 * Reports whether a shell without `-c` reads its script from stdin: it names
 * no script file, or says `-s` or `-` outright.
 * @param rest - The shell's argv.
 * @returns True when the shell runs whatever is fed to its stdin.
 */
function shellReadsStdin(rest: Tokens): boolean {
	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index] as string;
		if (STDIN_SCRIPT_FLAG.test(token) || token === '-') {
			return true;
		}
		if (token === '--') {
			return rest[index + 1] === undefined;
		}
		if (SHELL_VALUE_FLAGS.has(token)) {
			index += 1;
			continue;
		}
		if (!token.startsWith('-') && !token.startsWith('+')) {
			return false;
		}
	}
	return true;
}

/**
 * Finds the command a Nix development shell runs: the argv after `nix develop`
 * or `nix shell`'s `-c`/`--command`, or the string after `nix-shell --run`.
 * @param name - The normalised command name.
 * @param rest - Its argv.
 * @returns The nested commands, empty when the shell runs nothing given here.
 */
function nixShellCommands(name: string, rest: Tokens): NestedCommand[] {
	if (name === 'nix') {
		const verbAt = rest.findIndex(
			(token) => token === 'develop' || token === 'shell',
		);
		const commandAt = rest.findIndex(
			(token) => token === '-c' || token === '--command',
		);
		return verbAt !== -1 && commandAt > verbAt
			? [{ argv: rest.slice(commandAt + 1) }]
			: [];
	}
	if (name === 'nix-shell') {
		const runAt = rest.findIndex(
			(token) => token === '--run' || token === '--command',
		);
		const text = runAt === -1 ? undefined : rest[runAt + 1];
		return text === undefined ? [] : [{ text }];
	}
	return [];
}

/**
 * Finds every command a `find` runs through `-exec` and its kin.
 * @param rest - `find`'s argv.
 * @returns Each command's argv, up to its `;` or `+`.
 */
function findExecCommands(rest: Tokens): NestedCommand[] {
	const commands: NestedCommand[] = [];
	let start = -1;
	for (const [index, token] of rest.entries()) {
		if (start === -1 && FIND_EXEC_ACTIONS.has(token)) {
			start = index + 1;
		} else if (start !== -1 && FIND_EXEC_TERMINATORS.has(token)) {
			commands.push({ argv: rest.slice(start, index) });
			start = -1;
		}
	}
	return start === -1 ? commands : [...commands, { argv: rest.slice(start) }];
}

/**
 * Finds what a shell runs: its `-c` string, or else the script its stdin and
 * its process substitutions carry.
 * @param rest - The shell's argv.
 * @param feed - What the shell is fed.
 * @returns The nested commands.
 */
function shellCommands(rest: Tokens, feed: SegmentFeed): NestedCommand[] {
	const text = shellCommandString(rest);
	if (text !== null) {
		return [{ text }];
	}
	const fromStdin =
		feed.stdin !== null && shellReadsStdin(rest) ? [feed.stdin] : [];
	return [...fromStdin, ...feed.processScripts].map((script) => ({
		text: script,
	}));
}

/**
 * Finds the commands a normalised command runs inside itself.
 * @param tokens - The normalised argv.
 * @param feed - What the command is fed.
 * @returns The nested commands, empty when there are none.
 */
export function nestedCommands(
	tokens: Tokens,
	feed: SegmentFeed,
): NestedCommand[] {
	const [name = '', ...rest] = tokens;
	if (SHELLS.has(name)) {
		return shellCommands(rest, feed);
	}
	if (SOURCERS.has(name)) {
		return feed.processScripts.map((script) => ({ text: script }));
	}
	if (name === 'eval') {
		return [{ text: rest.join(' ') }];
	}
	if (name === 'watch') {
		return [{ text: skipOptions(rest, WATCH_VALUE_FLAGS).join(' ') }];
	}
	if (name === 'find') {
		return findExecCommands(rest);
	}
	return nixShellCommands(name, rest);
}

/**
 * Reads the text an `echo` or `printf` writes, for a pipe that feeds it to a shell.
 * @param tokens - The writing command's argv.
 * @returns The text written, or null when the command is neither.
 */
function echoedText(tokens: Tokens): string | null {
	const [name, ...args] = normaliseTokens(tokens);
	if (name !== 'echo' && name !== 'printf') {
		return null;
	}
	const operands =
		name === 'echo' ? args.filter((arg) => !ECHO_FLAGS.test(arg)) : args;
	return operands.join(' ').replaceAll('\\n', '\n');
}

/**
 * Reads what a segment writes to its stdout that the classifier can see: the
 * document it was fed, or the text it echoes.
 * @param segment - The writing segment.
 * @returns The text, or null when none is known.
 */
function writtenText(segment: ShellSegment): string | null {
	return segment.stdin ?? echoedText(segment.tokens);
}

/**
 * Reads the script a process substitution prints, from the commands inside it.
 * @param text - The process substitution's command text.
 * @returns The printed script, or null when nothing it prints is known.
 */
function printedScript(text: string): string | null {
	const printed = (lexShellSegments(text) ?? []).flatMap(
		(segment) => writtenText(segment) ?? [],
	);
	return printed.length > 0 ? printed.join('\n') : null;
}

/**
 * Bounds a fed script to what the classifier reads of it.
 * @param script - The script, or null.
 * @returns Its head, or null.
 */
function bounded(script: string | null): string | null {
	return script === null ? null : script.slice(0, MAX_FED_SCRIPT_CHARS);
}

/**
 * Finds what one segment of a command line is fed: its own heredoc or
 * here-string, or else whatever the segment before it pipes in; and the
 * scripts its process substitutions print.
 * @param segments - Every segment of the command line.
 * @param index - The segment whose feed to read.
 * @returns The feed, each script bounded in length.
 */
export function segmentFeed(
	segments: readonly ShellSegment[],
	index: number,
): SegmentFeed {
	const segment = segments[index];
	if (!segment) {
		return NO_FEED;
	}
	const feeder = index > 0 ? segments[index - 1] : undefined;
	const piped = feeder?.pipesOnward ? writtenText(feeder) : null;
	return {
		processScripts: segment.processInputs.flatMap(
			(text) => bounded(printedScript(text)) ?? [],
		),
		stdin: bounded(segment.stdin ?? piped),
	};
}
