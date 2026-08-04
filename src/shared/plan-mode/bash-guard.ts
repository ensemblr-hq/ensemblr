/**
 * Read-only classifier for `bash` commands an agent issues while its
 * conversation is in Plan Mode. Deny by default: a false block is recoverable —
 * the agent reads the reason and adapts — while a false allow silently mutates
 * the user's repository, which is the whole thing Plan Mode exists to prevent.
 *
 * Splitting the command into segments and tokens is {@link lexCommand}'s job.
 * This module only decides what a segment's head word is allowed to do.
 */
import { lexCommand } from './shell-lexer.ts';

/** Outcome of classifying a command: allowed, or denied with a reason. */
export type BashGuardVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Commands that only read. Deliberately small — it grows from real usage rather
 * than from guessing what an agent might want.
 */
const READ_ONLY_COMMANDS: ReadonlySet<string> = new Set([
	'basename',
	'cat',
	// `cd` changes the directory of a shell that exits with the command, and every
	// segment chained after it is still classified on its own.
	'cd',
	'column',
	'cut',
	'date',
	'df',
	'diff',
	'dirname',
	'du',
	'echo',
	'fd',
	'file',
	'grep',
	'head',
	'jq',
	'ls',
	'pwd',
	'realpath',
	'rg',
	'sort',
	'stat',
	'tail',
	'tree',
	'tr',
	'type',
	'uniq',
	'wc',
	'which',
]);

/**
 * Commands common enough that an agent will reach for them, but which take
 * arbitrary code or a script as an argument. Named explicitly so the block
 * reason says why rather than falling through to the generic denial.
 */
const CODE_EXECUTION_COMMANDS: ReadonlySet<string> = new Set([
	'awk',
	'bash',
	'bun',
	'bunx',
	'deno',
	// `env` runs whatever follows it, so `env FOO=bar npm test` would otherwise
	// walk straight past the allowlist that rejects a bare `npm`.
	'env',
	'eval',
	'exec',
	'make',
	'node',
	'npm',
	'npx',
	'perl',
	'php',
	'pnpm',
	'python',
	'python3',
	'ruby',
	'sed',
	'sh',
	'source',
	'tee',
	'xargs',
	'yarn',
	'zsh',
]);

/** `find` actions that run a command or delete/write files. */
const FIND_MUTATING_ACTIONS: ReadonlySet<string> = new Set([
	'-delete',
	'-exec',
	'-execdir',
	'-fls',
	'-fprint',
	'-fprint0',
	'-fprintf',
	'-ok',
	'-okdir',
]);

/** `git` subcommands that only inspect history, refs, and the working tree. */
const GIT_READ_SUBCOMMANDS: ReadonlySet<string> = new Set([
	'blame',
	'cat-file',
	'count-objects',
	'describe',
	'diff',
	'for-each-ref',
	'grep',
	'log',
	'ls-files',
	'ls-tree',
	'merge-base',
	'name-rev',
	'rev-list',
	'rev-parse',
	'shortlog',
	'show',
	'show-ref',
	'status',
]);

/**
 * `git` subcommands whose read-only forms are named actions rather than flags.
 * `git worktree list` inspects; `git worktree add` checks a branch out.
 */
const GIT_SUBCOMMAND_READ_ACTIONS: ReadonlyMap<
	string,
	ReadonlySet<string>
> = new Map([
	['stash', new Set(['list', 'show'])],
	['worktree', new Set(['list'])],
]);

/** `git branch` / `git remote` flags that mutate rather than list. */
const GIT_REF_MUTATING_FLAGS: ReadonlySet<string> = new Set([
	'--copy',
	'--delete',
	'--edit-description',
	'--force',
	'--move',
	'--set-upstream',
	'--set-upstream-to',
	'--unset-upstream',
	'-C',
	'-D',
	'-M',
	'-c',
	'-d',
	'-f',
	'-m',
	'-u',
]);

/** The `--flag=value` forms of {@link GIT_REF_MUTATING_FLAGS}. */
const GIT_REF_MUTATING_PREFIXES: readonly string[] = ['--set-upstream-to='];

/** `git remote` subcommands that mutate the configured remotes. */
const GIT_REMOTE_MUTATING_SUBCOMMANDS: ReadonlySet<string> = new Set([
	'add',
	'prune',
	'remove',
	'rename',
	'rm',
	'set-branches',
	'set-head',
	'set-url',
	'update',
]);

/** `git config` flags that read rather than write. */
const GIT_CONFIG_READ_FLAGS: ReadonlySet<string> = new Set([
	'--get',
	'--get-all',
	'--get-regexp',
	'--list',
	'-l',
]);

/** `gh` subcommand paths that only read from GitHub. */
const GH_READ_PATHS: ReadonlySet<string> = new Set([
	'issue list',
	'issue view',
	'pr checks',
	'pr diff',
	'pr list',
	'pr status',
	'pr view',
	'repo view',
	'run list',
	'run view',
]);

/** `git` global flags that consume the token after them. */
const GIT_VALUE_FLAGS: ReadonlySet<string> = new Set([
	'--git-dir',
	'--work-tree',
	'-C',
]);

/**
 * `git` global flags that hand git a program to run, which no read-only
 * subcommand makes safe. `-c diff.external=…` and `-c diff.<driver>.textconv=…`
 * execute during `git diff`, `-c core.fsmonitor=…` during `git status`, and
 * `-c core.pager=…` whenever git pages — none of it visible to the classifier,
 * because the command it runs is a config value rather than a token. Skipping
 * the value the way {@link GIT_VALUE_FLAGS} does would let all four through.
 */
const GIT_PROGRAM_INJECTING_FLAGS: ReadonlySet<string> = new Set([
	'--config-env',
	'--exec-path',
	'-c',
]);

/** The `--flag=value` forms of {@link GIT_PROGRAM_INJECTING_FLAGS}. */
const GIT_PROGRAM_INJECTING_PREFIXES: readonly string[] = [
	'--config-env=',
	'--exec-path=',
];

/** `git branch` flags that consume the token after them while still only listing. */
const GIT_BRANCH_VALUE_FLAGS: ReadonlySet<string> = new Set([
	'--contains',
	'--format',
	'--merged',
	'--no-contains',
	'--no-merged',
	'--points-at',
	'--sort',
]);

const ASSIGNMENT_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * A read-mostly command that a specific flag turns into a writer or a command
 * runner. `flags` matches a token exactly; `prefixes` matches the `--flag=value`
 * form; `label` names what the flag does, for the denial reason.
 */
interface FlagGuard {
	flags: ReadonlySet<string>;
	prefixes: readonly string[];
	label: string;
}

/**
 * The `--output`/`-o` guard shared by the commands that redirect stdout to a
 * file with no shell redirection for the `>` scan to catch: `sort -o`, `tree -o`,
 * and `git … --output`. Scoped to those commands on purpose — `grep -o` and
 * `rg -o` mean `--only-matching` and only read.
 */
const OUTPUT_FILE_GUARD: FlagGuard = {
	flags: new Set(['--output', '-o']),
	label: 'writes its output to a file',
	prefixes: ['--output='],
};

/**
 * Allowlisted commands that a single flag turns into a writer or a command
 * runner, screened before the allowlist clears them. `fd -x`/`rg --pre` execute
 * arbitrary programs and `date -s` sets the clock, yet the plain read forms
 * (`fd -tf`, `rg -o`, `date +%s`) still pass. `--pre-glob` is deliberately not
 * caught: it only filters which files `--pre` runs on and executes nothing.
 */
const FLAG_GUARDED_COMMANDS: ReadonlyMap<string, FlagGuard> = new Map([
	[
		'fd',
		{
			flags: new Set(['--exec', '--exec-batch', '-X', '-x']),
			label: 'runs a command for every match',
			prefixes: ['--exec='],
		},
	],
	[
		'rg',
		{
			flags: new Set(['--hostname-bin', '--pre']),
			label: 'runs a program for every file',
			prefixes: ['--hostname-bin=', '--pre='],
		},
	],
	[
		'date',
		{
			flags: new Set(['--set', '-s']),
			label: 'sets the system clock',
			prefixes: ['--set='],
		},
	],
	['sort', OUTPUT_FILE_GUARD],
	['tree', OUTPUT_FILE_GUARD],
]);

/**
 * Extra flag guards for individual read-only `git` subcommands, screened
 * alongside {@link OUTPUT_FILE_GUARD}. `git grep -O` hands every match to a pager
 * command of the caller's choosing, so it runs a program the classifier cannot see.
 */
const GIT_SUBCOMMAND_FLAG_GUARDS: ReadonlyMap<string, FlagGuard> = new Map([
	[
		'grep',
		{
			flags: new Set(['--open-files-in-pager', '-O']),
			label: 'runs a pager program of its own',
			prefixes: ['--open-files-in-pager=', '-O'],
		},
	],
]);

/**
 * Finds the first argument that trips a flag guard, matching both the bare
 * `--flag` form and the `--flag=value` form.
 * @param args - Tokens after the head word.
 * @param guard - The command's flag guard.
 * @returns The offending flag, or null when none is present.
 */
function findGuardedFlag(
	args: readonly string[],
	guard: FlagGuard,
): string | null {
	return (
		args.find(
			(token) =>
				guard.flags.has(token) ||
				guard.prefixes.some((prefix) => token.startsWith(prefix)),
		) ?? null
	);
}

/**
 * Drops the leading `FOO=bar` environment assignments so the head word is the
 * command the segment actually runs.
 * @param tokens - One lexed segment.
 * @returns The tokens from the head word onward.
 */
function stripAssignments(tokens: readonly string[]): readonly string[] {
	let start = 0;
	while (start < tokens.length && ASSIGNMENT_PREFIX.test(tokens[start] ?? '')) {
		start += 1;
	}
	return tokens.slice(start);
}

/**
 * Denies a segment with a reason naming the offending command.
 * @param reason - Why the segment was rejected.
 * @returns The denial verdict.
 */
function deny(reason: string): BashGuardVerdict {
	return { ok: false, reason };
}

/**
 * Classifies a `find` invocation, rejecting the actions that execute or delete.
 * @param args - Tokens after the `find` head word.
 * @returns Allowed unless a mutating action is present.
 */
function evaluateFind(args: readonly string[]): BashGuardVerdict {
	const action = args.find((token) => FIND_MUTATING_ACTIONS.has(token));
	return action === undefined
		? { ok: true }
		: deny(`\`find ${action}\` runs commands or deletes files`);
}

/** The tokens at `git`'s subcommand, or the global flag that disqualified it. */
type GitGlobals = { rest: readonly string[] } | { violation: string };

/**
 * Reports whether a `git` global flag names a program for git to run.
 * @param flag - One global flag token, in either the bare or `--flag=value` form.
 * @returns True when the flag injects configuration or relocates git's helpers.
 */
function injectsGitProgram(flag: string): boolean {
	return (
		GIT_PROGRAM_INJECTING_FLAGS.has(flag) ||
		GIT_PROGRAM_INJECTING_PREFIXES.some((prefix) => flag.startsWith(prefix))
	);
}

/**
 * Drops `git`'s global flags (and the values they consume) to reach the
 * subcommand, rejecting the ones that hand git a program to run.
 * @param args - Tokens after the `git` head word.
 * @returns The tokens starting at the subcommand, or the violation to report.
 */
function skipGitGlobalFlags(args: readonly string[]): GitGlobals {
	let index = 0;
	while (index < args.length && (args[index] ?? '').startsWith('-')) {
		const flag = args[index] ?? '';
		if (injectsGitProgram(flag)) {
			return {
				violation: `\`git ${flag}\` sets configuration that can name a program git runs`,
			};
		}
		index += GIT_VALUE_FLAGS.has(flag) ? 2 : 1;
	}
	return { rest: args.slice(index) };
}

/**
 * Reports whether `git branch` was handed a bare name, which creates or resets a
 * ref. `--list` marks its positional as a match pattern rather than a new name.
 * @param rest - Tokens after the `branch` subcommand.
 * @returns True when a positional argument would write a ref.
 */
function createsGitBranch(rest: readonly string[]): boolean {
	if (rest.includes('--list')) {
		return false;
	}
	let index = 0;
	while (index < rest.length) {
		const token = rest[index] ?? '';
		if (!token.startsWith('-')) {
			return true;
		}
		index += GIT_BRANCH_VALUE_FLAGS.has(token) ? 2 : 1;
	}
	return false;
}

/**
 * Screens a read-only `git` subcommand for the flags that turn it into a writer
 * or a program runner.
 * @param subcommand - The git subcommand already cleared as read-only.
 * @param rest - Tokens after the subcommand.
 * @returns A denial naming the offending flag, or null when there is none.
 */
function evaluateGitReadFlags(
	subcommand: string,
	rest: readonly string[],
): BashGuardVerdict | null {
	const guards = [
		OUTPUT_FILE_GUARD,
		GIT_SUBCOMMAND_FLAG_GUARDS.get(subcommand),
	];
	for (const guard of guards) {
		const flag = guard === undefined ? null : findGuardedFlag(rest, guard);
		if (guard !== undefined && flag !== null) {
			return deny(`\`git ${subcommand} ${flag}\` ${guard.label}`);
		}
	}
	return null;
}

/**
 * Classifies a `git` subcommand whose read-only form is a named action rather
 * than a flag.
 * @param subcommand - The git subcommand.
 * @param readActions - Actions that only inspect.
 * @param rest - Tokens after the subcommand.
 * @returns Allowed only when the named action is one that inspects.
 */
function evaluateGitReadAction(
	subcommand: string,
	readActions: ReadonlySet<string>,
	rest: readonly string[],
): BashGuardVerdict {
	const action = rest.find((token) => !token.startsWith('-'));
	if (action !== undefined && readActions.has(action)) {
		return { ok: true };
	}
	const allowed = [...readActions].map((name) => `\`${name}\``).join(' or ');
	return deny(
		`\`git ${subcommand}\` is read-only in Plan Mode with ${allowed}`,
	);
}

/**
 * Classifies `git branch` and `git remote`, which list refs until a flag or a
 * named action turns them into ref surgery.
 * @param subcommand - Either `branch` or `remote`.
 * @param rest - Tokens after the subcommand.
 * @returns Allowed unless a mutating flag or action is present.
 */
function evaluateGitRefs(
	subcommand: string,
	rest: readonly string[],
): BashGuardVerdict {
	const mutation = rest.find(
		(token) =>
			GIT_REF_MUTATING_FLAGS.has(token) ||
			GIT_REF_MUTATING_PREFIXES.some((prefix) => token.startsWith(prefix)) ||
			(subcommand === 'remote' && GIT_REMOTE_MUTATING_SUBCOMMANDS.has(token)),
	);
	if (mutation !== undefined) {
		return deny(`\`git ${subcommand} ${mutation}\` mutates refs`);
	}
	if (subcommand === 'branch' && createsGitBranch(rest)) {
		return deny(
			'`git branch <name>` creates a ref; `git branch` and `git branch --list` only list',
		);
	}
	return { ok: true };
}

/**
 * Classifies `git config`, which reads only when a reading flag says so.
 * @param rest - Tokens after `config`.
 * @returns Allowed only for the reading flags.
 */
function evaluateGitConfig(rest: readonly string[]): BashGuardVerdict {
	return rest.some((token) => GIT_CONFIG_READ_FLAGS.has(token))
		? { ok: true }
		: deny('`git config` is read-only in Plan Mode with `--get` or `--list`');
}

/**
 * Classifies a `git` invocation against the read-only subcommand allowlist,
 * with narrower rules for the subcommands that both read and write.
 * @param args - Tokens after the `git` head word.
 * @returns Allowed only for inspection subcommands.
 */
function evaluateGit(args: readonly string[]): BashGuardVerdict {
	const globals = skipGitGlobalFlags(args);
	if ('violation' in globals) {
		return deny(globals.violation);
	}
	const [subcommand, ...rest] = globals.rest;
	if (!subcommand) {
		return deny('`git` needs a read-only subcommand in Plan Mode');
	}
	if (GIT_READ_SUBCOMMANDS.has(subcommand)) {
		return evaluateGitReadFlags(subcommand, rest) ?? { ok: true };
	}
	const readActions = GIT_SUBCOMMAND_READ_ACTIONS.get(subcommand);
	if (readActions) {
		return evaluateGitReadAction(subcommand, readActions, rest);
	}
	if (subcommand === 'branch' || subcommand === 'remote') {
		return evaluateGitRefs(subcommand, rest);
	}
	if (subcommand === 'config') {
		return evaluateGitConfig(rest);
	}
	return deny(`\`git ${subcommand}\` is not a read-only git subcommand`);
}

/**
 * Classifies a `gh` invocation against the read-only `<resource> <action>`
 * allowlist.
 * @param args - Tokens after the `gh` head word.
 * @returns Allowed only for inspection paths.
 */
function evaluateGh(args: readonly string[]): BashGuardVerdict {
	const path = args
		.filter((token) => !token.startsWith('-'))
		.slice(0, 2)
		.join(' ');
	return GH_READ_PATHS.has(path)
		? { ok: true }
		: deny(`\`gh ${path || '(no subcommand)'}\` is not a read-only gh command`);
}

/**
 * Denies an allowlisted command that a flag turned into a writer or a command
 * runner (`fd -x`, `rg --pre`, `date -s`, `sort -o`).
 * @param head - The classified command.
 * @param args - Tokens after the head word.
 * @returns A denial when a guarded flag is present; null when the command is not
 *   flag-guarded or is used in its read-only form.
 */
function evaluateFlagGuard(
	head: string,
	args: readonly string[],
): BashGuardVerdict | null {
	const guard = FLAG_GUARDED_COMMANDS.get(head);
	if (guard === undefined) {
		return null;
	}
	const flag = findGuardedFlag(args, guard);
	return flag === null ? null : deny(`\`${head} ${flag}\` ${guard.label}`);
}

/**
 * Classifies one chained command from the full invocation.
 * @param segment - The lexed tokens of a single command between shell separators.
 * @returns Allowed when its head word is read-only, denied otherwise.
 */
function evaluateSegment(segment: readonly string[]): BashGuardVerdict {
	const tokens = stripAssignments(segment);
	const head = tokens[0];
	if (head === undefined) {
		return { ok: true };
	}
	const args = tokens.slice(1);
	if (head === 'find') {
		return evaluateFind(args);
	}
	if (head === 'git') {
		return evaluateGit(args);
	}
	if (head === 'gh') {
		return evaluateGh(args);
	}
	const guarded = evaluateFlagGuard(head, args);
	if (guarded) {
		return guarded;
	}
	if (READ_ONLY_COMMANDS.has(head)) {
		return { ok: true };
	}
	if (CODE_EXECUTION_COMMANDS.has(head)) {
		return deny(`\`${head}\` can run arbitrary code`);
	}
	return deny(`\`${head}\` is not on the Plan Mode read-only allowlist`);
}

/**
 * Reports whether a bash command only reads. Rejects the whole invocation when
 * any part of it redirects, substitutes, or is not on the allowlist.
 * @param command - The command the agent asked to run.
 * @returns Allowed, or denied with the reason to hand back to the agent.
 */
export function isReadOnlyBashCommand(command: string): BashGuardVerdict {
	if (command.trim().length === 0) {
		return deny('an empty command cannot be classified as read-only');
	}
	const lexed = lexCommand(command);
	if (lexed.violation) {
		return deny(lexed.violation);
	}
	for (const segment of lexed.segments) {
		const verdict = evaluateSegment(segment);
		if (!verdict.ok) {
			return verdict;
		}
	}
	return { ok: true };
}
