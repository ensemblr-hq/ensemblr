/**
 * Finds the `git` invocations in a Bash command and what each one points at:
 * the subcommand and its arguments, and every path that moves git off the
 * session's own checkout (`cd`/`pushd`, `-C`, `--git-dir`, `--work-tree`,
 * `GIT_DIR`, `GIT_WORK_TREE`), resolved against the directory the command
 * runs in.
 */
import { SUBSHELL_CLOSE, SUBSHELL_OPEN, splitCommands } from './shell-words.ts';

/** How a path redirected git: a directory change, a global option, or an environment variable. */
export type GitTargetSource =
	| 'cd'
	| '-C'
	| '--git-dir'
	| '--work-tree'
	| 'GIT_DIR'
	| 'GIT_WORK_TREE';

/** One redirection of git, its path absolute, or null when it cannot be read. */
export interface GitTarget {
	path: string | null;
	source: GitTargetSource;
}

/** One `git` the command would start. */
export interface GitInvocation {
	args: readonly string[];
	subcommand: string | null;
	targets: readonly GitTarget[];
}

/** The directory a command runs in (null once a `cd` lost it) and the home directory. */
export interface ShellContext {
	cwd: string | null;
	home: string | null;
}

/** Words that lead a simple command without being the program it runs. */
const COMMAND_PREFIXES = new Set([
	'!',
	'{',
	'}',
	'builtin',
	'command',
	'do',
	'elif',
	'else',
	'exec',
	'if',
	'nohup',
	'then',
	'time',
	'until',
	'while',
]);

/** A program that runs another one: its options that take a value, and the positionals before the program. */
interface Wrapper {
	positionals: number;
	valueOptions: ReadonlySet<string>;
}

/** Wrappers a command in good faith is plausibly started through. */
const WRAPPERS: ReadonlyMap<string, Wrapper> = new Map([
	['env', { positionals: 0, valueOptions: new Set(['-u', '--unset', '-S']) }],
	['nice', { positionals: 0, valueOptions: new Set(['-n', '--adjustment']) }],
	[
		'sudo',
		{
			positionals: 0,
			valueOptions: new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-U']),
		},
	],
	[
		'timeout',
		{
			positionals: 1,
			valueOptions: new Set(['-s', '--signal', '-k', '--kill-after']),
		},
	],
	[
		'xargs',
		{
			positionals: 0,
			valueOptions: new Set([
				'-a',
				'-d',
				'-E',
				'-e',
				'-I',
				'-L',
				'-n',
				'-P',
				'-s',
			]),
		},
	],
]);

/** `cd` and `pushd` flags that change how a path resolves, not which. */
const CD_FLAGS = /^-[LPe@]+$/;

/** Environment variables that point git at another repository or checkout. */
const TARGET_VARIABLES = new Set<GitTargetSource>(['GIT_DIR', 'GIT_WORK_TREE']);

/** A shell variable assignment, `NAME=value`. */
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;

/** Git global options that take the next word as their value. */
const VALUE_OPTIONS = new Set(['-c', '--config-env', '--namespace']);

/**
 * Expands a leading `~` the way the shell would.
 * @param path - The path as written.
 * @param home - The home directory, or null when unknown.
 * @returns The expanded path, or null when it needs a home nobody knows.
 */
function expandHome(path: string, home: string | null): string | null {
	if (path !== '~' && !path.startsWith('~/')) {
		return path;
	}
	return home === null ? null : `${home}${path.slice(1)}`;
}

/**
 * Resolves a path lexically against a directory, `~` expanded.
 * @param base - Absolute directory relative paths start from, or null when unknown.
 * @param path - The path as written.
 * @param home - The home directory, or null when unknown.
 * @returns The absolute path, or null when it cannot be read without running the shell.
 */
function resolvePath(
	base: string | null,
	path: string,
	home: string | null,
): string | null {
	const expanded =
		path.includes('$') || path.includes('`') ? null : expandHome(path, home);
	if (expanded === null || (base === null && !expanded.startsWith('/'))) {
		return null;
	}
	const joined = expanded.startsWith('/') ? expanded : `${base}/${expanded}`;
	const kept: string[] = [];
	for (const part of joined.split('/')) {
		if (part === '..') {
			kept.pop();
		} else if (part !== '' && part !== '.') {
			kept.push(part);
		}
	}
	return `/${kept.join('/')}`;
}

/**
 * Reads a `git` command's global options, from the word after `git` to its subcommand.
 * @param words - The words after `git`.
 * @param context - Where the command runs, for resolving `-C` and friends.
 * @param inherited - Targets the environment already set (`GIT_DIR=...`).
 * @returns The invocation.
 */
function readGitWords(
	words: readonly string[],
	context: ShellContext,
	inherited: readonly GitTarget[],
): GitInvocation {
	const targets = [...inherited];
	let directory = context.cwd;
	let index = 0;
	while (index < words.length) {
		const word = words[index] ?? '';
		if (!word.startsWith('-')) {
			break;
		}
		const [flag, attached] = word.split(/=(.*)/s, 2);
		const value = attached ?? words[index + 1] ?? '';
		if (word === '-C') {
			directory = resolvePath(directory, value, context.home);
			targets.push({ path: directory, source: '-C' });
			index += 2;
		} else if (flag === '--git-dir' || flag === '--work-tree') {
			targets.push({
				path: resolvePath(directory, value, context.home),
				source: flag,
			});
			index += attached === undefined ? 2 : 1;
		} else {
			index += VALUE_OPTIONS.has(word) ? 2 : 1;
		}
	}
	return {
		args: words.slice(index + 1),
		subcommand: words[index] ?? null,
		targets,
	};
}

/**
 * Collects the git targets a run of assignments sets, resolved against the cwd.
 * @param assignments - `NAME=value` words.
 * @param context - Where the command runs.
 * @returns The targets among them.
 */
function targetsFromAssignments(
	assignments: readonly string[],
	context: ShellContext,
): GitTarget[] {
	return assignments.flatMap((assignment) => {
		const [, name, value] = ASSIGNMENT.exec(assignment) ?? [];
		return name && TARGET_VARIABLES.has(name as GitTargetSource)
			? [
					{
						path: resolvePath(context.cwd, value ?? '', context.home),
						source: name as GitTargetSource,
					},
				]
			: [];
	});
}

/**
 * Skips a wrapper's options and leading positionals.
 * @param words - One simple command's words.
 * @param start - Index of the first word after the wrapper's name.
 * @param wrapper - The wrapper's option table.
 * @returns Index of the first word of the program it runs.
 */
function skipWrapper(
	words: readonly string[],
	start: number,
	wrapper: Wrapper,
): number {
	let index = start;
	while ((words[index] ?? '').startsWith('-')) {
		index += wrapper.valueOptions.has(words[index] ?? '') ? 2 : 1;
	}
	return index + wrapper.positionals;
}

/**
 * Drops the words that lead a command without naming its program: shell
 * keywords, wrappers such as `sudo`, `env` or `timeout` and their options,
 * and assignments.
 * @param words - One simple command's words.
 * @returns The assignments it carried and the words from its program on.
 */
function stripPrefixes(words: readonly string[]): {
	assignments: string[];
	program: readonly string[];
} {
	const assignments: string[] = [];
	let index = 0;
	while (index < words.length) {
		const word = words[index] ?? '';
		const wrapper = WRAPPERS.get(word);
		if (ASSIGNMENT.test(word)) {
			assignments.push(word);
		} else if (wrapper) {
			index = skipWrapper(words, index + 1, wrapper);
			continue;
		} else if (!COMMAND_PREFIXES.has(word)) {
			break;
		}
		index += 1;
	}
	return { assignments, program: words.slice(index) };
}

/**
 * Whether a word names the git program, bare or by path.
 * @param word - The program word.
 * @returns True for `git` and `/usr/bin/git`.
 */
function isGit(word: string | undefined): boolean {
	return word === 'git' || (word?.endsWith('/git') ?? false);
}

/** Where the shell stands while a command line is read. */
interface ShellState {
	cwd: string | null;
	exported: readonly GitTarget[];
	pushed: readonly (string | null)[];
}

/**
 * Resolves where `cd` or `pushd` lands.
 * @param state - Where the shell stands.
 * @param args - The command's arguments.
 * @param home - The home directory.
 * @returns The new directory, or null when it cannot be read (`cd -`, an unknown flag).
 */
function changeDirectory(
	state: ShellState,
	args: readonly string[],
	home: string | null,
): string | null {
	const operands = args.filter((arg) => !CD_FLAGS.test(arg));
	const [target] = operands;
	if (target === '-' || target?.startsWith('-')) {
		return null;
	}
	return resolvePath(state.cwd, target ?? '~', home);
}

/**
 * Applies one simple command to where the shell stands.
 * @param state - Where the shell stands before it.
 * @param program - The command, prefixes stripped.
 * @param home - The home directory.
 * @returns Where the shell stands after it.
 */
function applyShellCommand(
	state: ShellState,
	program: readonly string[],
	home: string | null,
): ShellState {
	const [name, ...rest] = program;
	switch (name) {
		case 'cd':
			return { ...state, cwd: changeDirectory(state, rest, home) };
		case 'pushd':
			return {
				...state,
				cwd: rest.length === 0 ? null : changeDirectory(state, rest, home),
				pushed: [...state.pushed, state.cwd],
			};
		case 'popd':
			return {
				...state,
				cwd: state.pushed.length === 0 ? null : (state.pushed.at(-1) ?? null),
				pushed: state.pushed.slice(0, -1),
			};
		case 'export':
			return {
				...state,
				exported: [
					...state.exported,
					...targetsFromAssignments(rest, { cwd: state.cwd, home }),
				],
			};
		default:
			return state;
	}
}

/**
 * Finds every `git` a Bash command would start, following `cd`, `pushd`,
 * `export`, and subshells through the command, so a git run after changing
 * directory, a relative `-C`, or a `GIT_DIR` exported earlier in the line is
 * read where it lands.
 * @param command - The Bash command line.
 * @param context - The directory the command starts in and the home directory.
 * @returns Each git invocation, in order.
 */
export function findGitInvocations(
	command: string,
	context: ShellContext,
): GitInvocation[] {
	const { home } = context;
	let state: ShellState = { cwd: context.cwd, exported: [], pushed: [] };
	const subshells: ShellState[] = [];
	const found: GitInvocation[] = [];
	for (const words of splitCommands(command)) {
		const { assignments, program } = stripPrefixes(words);
		const [name, ...rest] = program;
		if (words.length === 1 && name === SUBSHELL_OPEN) {
			subshells.push(state);
		} else if (words.length === 1 && name === SUBSHELL_CLOSE) {
			state = subshells.pop() ?? state;
		} else if (isGit(name)) {
			const here: ShellContext = { cwd: state.cwd, home };
			const moved: GitTarget[] =
				state.cwd === context.cwd ? [] : [{ path: state.cwd, source: 'cd' }];
			found.push(
				readGitWords(rest, here, [
					...moved,
					...state.exported,
					...targetsFromAssignments(assignments, here),
				]),
			);
		} else {
			state = applyShellCommand(state, program, home);
		}
	}
	return found;
}
