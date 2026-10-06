/**
 * The git moves Ensemblr's playbook forbids, decided per invocation: renaming the
 * branch behind the app, touching the stash stack every worktree shares, and
 * writing to a checkout other than the session's own. Each refusal says what to
 * do instead, because a bare "denied" only sends the model hunting for a
 * spelling that gets through.
 */
import type { GitInvocation } from './git-command.ts';

/** The checkout this session owns: its worktree root and its own git directory. */
export interface WorktreeScope {
	gitDir: string | null;
	root: string;
}

/** Subcommands that only read, which may look at any repository. */
const READ_ONLY_SUBCOMMANDS = new Set([
	'blame',
	'cat-file',
	'check-ignore',
	'cherry',
	'count-objects',
	'describe',
	'diff',
	'for-each-ref',
	'grep',
	'help',
	'log',
	'ls-files',
	'ls-remote',
	'ls-tree',
	'merge-base',
	'name-rev',
	'rev-list',
	'rev-parse',
	'shortlog',
	'show',
	'show-ref',
	'status',
	'var',
	'version',
]);

/** Subcommands that create a repository rather than write into one. */
const CREATES_A_REPOSITORY = new Set(['clone', 'init']);

/** `git branch` flags that only list. */
const BRANCH_LIST_FLAGS = new Set([
	'-a',
	'--all',
	'-l',
	'--list',
	'-r',
	'--remotes',
	'-v',
	'-vv',
	'--verbose',
	'--show-current',
	'--no-color',
]);

/** A full or abbreviated commit id, the only stash reference `apply` may take. */
const COMMIT_ID = /^[0-9a-f]{7,40}$/i;

const RENAME_DENIAL =
	'ensemblr git-guard: renaming the branch with `git branch -m` moves it behind Ensemblr, which leaves the workspace pointing at a branch that no longer exists. When the user asked for a different branch name, call `mcp__ensemblr__ensemblr_set_branch_name` with `userRequested: true`; it renames the workspace and the branch together.';

const STASH_RECIPE =
	'Prefer a temporary WIP commit. If you must stash: `git stash push -u -m "<unique-tag>"`, capture its SHA with `git stash list --format=\'%H %gs\'`, restore with `git stash apply <sha>`, then re-find its `stash@{n}` by tag and `git stash drop stash@{n}`.';

const STASH_DENIAL = `ensemblr git-guard: the stash stack is shared by every worktree of this repository, and other sessions push and pop it concurrently, so this could take or destroy another session's changes. ${STASH_RECIPE}`;

/**
 * Whether a word is an option rather than a positional argument.
 * @param word - One argument.
 * @returns True for `-x` and `--long` forms.
 */
function isOption(word: string): boolean {
	return word.startsWith('-') && word !== '-';
}

/**
 * Whether a `git branch` call renames a branch.
 * @param args - The arguments after `branch`.
 * @returns True for `-m`, `-M`, `--move`, and short clusters holding either.
 */
function isBranchRename(args: readonly string[]): boolean {
	return args.some(
		(arg) => arg === '--move' || (/^-[A-Za-z]+$/.test(arg) && /[mM]/.test(arg)),
	);
}

/**
 * Whether stash options carry a message, so the entry can be found by its tag.
 * @param args - The options of `git stash push`.
 * @returns True when `-m` or `--message` is present.
 */
function hasStashMessage(args: readonly string[]): boolean {
	return args.some(
		(arg) => /^--message(=|$)/.test(arg) || /^-[A-Za-z]*m/.test(arg),
	);
}

/**
 * Decides a `git stash` call against the shared-stack recipe.
 * @param args - The arguments after `stash`.
 * @returns The refusal, or null when the call keeps to the recipe.
 */
function judgeStash(args: readonly string[]): string | null {
	const [first, ...rest] = args;
	if (first === undefined) {
		return STASH_DENIAL;
	}
	if (isOption(first) || first === 'push') {
		const options = first === 'push' ? rest : args;
		return hasStashMessage(options)
			? null
			: `ensemblr git-guard: a stash without a unique message cannot be found again by tag once other sessions push onto the shared stack. ${STASH_RECIPE}`;
	}
	const positionals = rest.filter((arg) => !isOption(arg));
	switch (first) {
		case 'list':
		case 'show':
		case 'create':
		case 'store':
			return null;
		case 'apply':
			return positionals.some((arg) => COMMIT_ID.test(arg))
				? null
				: `ensemblr git-guard: \`git stash apply\` must name your entry by its commit SHA, written literally, not by position or through a variable, because other sessions move the shared stack. ${STASH_RECIPE}`;
		case 'drop':
			return positionals.length > 0 ? null : STASH_DENIAL;
		default:
			return STASH_DENIAL;
	}
}

/**
 * Whether a call only reads, so it may look at a repository outside the worktree.
 * @param invocation - The git invocation.
 * @returns True for the read-only subcommands and the listing forms of the rest.
 */
function isReadOnly({ args, subcommand }: GitInvocation): boolean {
	if (subcommand === null) {
		return true;
	}
	if (READ_ONLY_SUBCOMMANDS.has(subcommand)) {
		return !args.some((arg) => arg.startsWith('--output'));
	}
	switch (subcommand) {
		case 'branch':
			return args.every((arg) => BRANCH_LIST_FLAGS.has(arg));
		case 'worktree':
			return args[0] === 'list';
		case 'remote':
			return (
				args.every((arg) => arg === '-v' || arg === '--verbose') ||
				args[0] === 'get-url' ||
				args[0] === 'show'
			);
		case 'stash':
			return args[0] === 'list' || args[0] === 'show';
		case 'reflog':
			return (
				args[0] === undefined ||
				args[0] === 'show' ||
				args[0] === 'exists' ||
				isOption(args[0])
			);
		case 'config':
			return args.some((arg) => /^(--get|--list$|-l$)/.test(arg));
		default:
			return false;
	}
}

/**
 * Whether a path lies inside a directory.
 * @param path - The absolute path.
 * @param directory - The absolute directory.
 * @returns True for the directory itself and anything beneath it.
 */
function isWithin(path: string, directory: string): boolean {
	const root = directory.replace(/\/+$/, '');
	return path === root || path.startsWith(`${root}/`);
}

/**
 * Decides whether every redirection of a call stays on the session's checkout.
 * @param invocation - The git invocation.
 * @param scope - The session's worktree root and git directory.
 * @returns The refusal, or null when nothing points elsewhere or the call only reads.
 */
function judgeTargets(
	invocation: GitInvocation,
	scope: WorktreeScope,
): string | null {
	const stray = invocation.targets.find(
		({ path }) =>
			path === null ||
			!(
				isWithin(path, scope.root) ||
				(scope.gitDir !== null && isWithin(path, scope.gitDir))
			),
	);
	if (
		stray === undefined ||
		isReadOnly(invocation) ||
		CREATES_A_REPOSITORY.has(invocation.subcommand ?? '')
	) {
		return null;
	}
	const where =
		stray.path === null
			? 'a path this guard cannot read without running the shell (write it as a literal path)'
			: `\`${stray.path}\``;
	return `ensemblr git-guard: through \`${stray.source}\`, this git command would act on ${where}, outside this session's worktree \`${scope.root}\`. Write only in your own worktree: a sibling workspace or the root checkout is not yours to change, and git writes there land in another session's index and branch. Read-only commands (status, log, diff, show, ...) may look elsewhere.`;
}

/**
 * Decides one git invocation.
 * @param invocation - The git invocation.
 * @param scope - The session's worktree root and git directory.
 * @returns The refusal the model reads, or null to let the call run.
 */
export function judgeGitInvocation(
	invocation: GitInvocation,
	scope: WorktreeScope,
): string | null {
	const ruleDenial =
		invocation.subcommand === 'branch' && isBranchRename(invocation.args)
			? RENAME_DENIAL
			: invocation.subcommand === 'stash'
				? judgeStash(invocation.args)
				: null;
	return ruleDenial ?? judgeTargets(invocation, scope);
}
