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

/** `uniq` flags that consume the token after them, which is a count rather than a file. */
const UNIQ_VALUE_FLAGS: ReadonlySet<string> = new Set([
	'--check-chars',
	'--skip-chars',
	'--skip-fields',
	'-f',
	'-s',
	'-w',
]);

const ASSIGNMENT_PREFIX = /^([A-Za-z_][A-Za-z0-9_]*)=/;

/**
 * A read-mostly command that a specific flag turns into a writer or a command
 * runner. `flags` holds both spellings of each flag, the long `--name` and the
 * short `-x`; the `--name=value`, abbreviated-long, and clustered forms are
 * derived rather than listed. `label` names what the flag does, for the denial
 * reason.
 *
 * `valueLetters` names the short letters of *this command* that consume the
 * rest of their token as a value, which stops the cluster scan before it reads
 * that value as more flags. Its two directions are not symmetric: a letter left
 * out over-blocks a read-only command, while a letter wrongly added under-blocks
 * a writing one, so the bar for adding one is evidence rather than a false
 * positive somebody wanted quiet.
 *
 * The table holds two grades of that evidence, and they are not interchangeable.
 * `fd -e`/`-t` and `date -I`/`-d`/`-f`/`-r`/`-v` were **measured** against the
 * installed binaries: each answers `option requires an argument` bare, and each
 * swallows a guarded letter into its value rather than letting it through.
 * `tree -I`/`-P` rest on tree's **documented interface alone**, because tree is
 * not installed on the machines this was written on — a weaker bar, taken
 * because both are unambiguous in every tree manual and the only letter `tree`
 * guards is `-o`. Measure a letter wherever the binary is there to answer, and
 * say here when it was not.
 */
interface FlagGuard {
	flags: ReadonlySet<string>;
	label: string;
	valueLetters?: ReadonlySet<string>;
}

/**
 * The `--output`/`-o` guard for the commands that redirect stdout to a file
 * with no shell redirection for the `>` scan to catch. Scoped to `sort` and
 * `tree` on purpose — `grep -o` and `rg -o` mean `--only-matching` and only
 * read.
 */
const SORT_OUTPUT_FILE_GUARD: FlagGuard = {
	flags: new Set(['--output', '-o']),
	label: 'writes its output to a file',
};

/**
 * {@link SORT_OUTPUT_FILE_GUARD} for `tree`, whose two pattern flags take their
 * value attached — `-I` excludes matching files and `-P` lists only those that
 * match — so `tree -Iout` and `tree -Pfoo` are patterns rather than the `-o`
 * that writes a file.
 */
const TREE_OUTPUT_FILE_GUARD: FlagGuard = {
	flags: new Set(['--output', '-o']),
	label: 'writes its output to a file',
	valueLetters: new Set(['I', 'P']),
};

/**
 * The output-file guard for `git`'s read-only subcommands, long-only because
 * git has no short output flag anywhere: `git diff -o` answers `invalid option`,
 * and `git diff -O<file>` reads an orderfile. A set with no short flag in it
 * cannot trip the cluster scan at all, which is what keeps `git status -uno`,
 * `git log -S<term>`, `git ls-files -o` and `git for-each-ref --sort` readable.
 */
const GIT_OUTPUT_FILE_GUARD: FlagGuard = {
	flags: new Set(['--output']),
	label: 'writes its output to a file',
};

/**
 * The guard for `sort --compress-program=PROG`, which names a program `sort`
 * **execs** whenever it spills a run to a temporary file. It is a full
 * arbitrary-code escape from the allowlist — `sort -S 1 --compress-program=x f`
 * runs `x` — and it is GNU coreutils' flag adopted by the BSD/Apple `sort`, so
 * both target platforms carry it. Separate from
 * {@link SORT_OUTPUT_FILE_GUARD} because the two do different things and the
 * denial names which one fired. No short spelling exists, so the cluster scan is
 * untouched and `sort -S`, `sort -T/tmp/x` and `sort -no` keep working.
 */
const SORT_COMPRESS_PROGRAM_GUARD: FlagGuard = {
	flags: new Set(['--compress-program']),
	label: 'runs a program to compress its temporary files',
};

/**
 * The guard for `file -C`, which compiles the named magic source and writes
 * `<magicfile>.mgc` beside it — a file created where the agent chooses while
 * writes are blocked. `file -m <magicfile>` on its own only reads.
 *
 * `valueLetters` holds `e`, `F`, `m` and `M`, each **measured** against the
 * installed `file` (every one answers `option requires an argument` bare), so
 * `file -mC` is the magic file named `C` rather than the compile flag. `-C`
 * itself takes no argument, which the same probe confirmed.
 */
const FILE_COMPILE_GUARD: FlagGuard = {
	flags: new Set(['--compile', '-C']),
	label: 'compiles a magic file and writes it to disk',
	valueLetters: new Set(['F', 'M', 'e', 'm']),
};

/**
 * Allowlisted commands that a single flag turns into a writer or a command
 * runner, screened before the allowlist clears them. `fd -x`/`rg --pre` execute
 * arbitrary programs and `date -s` sets the clock, yet the plain read forms
 * (`fd -tf`, `rg -o`, `date +%s`) still pass. `--pre-glob` is deliberately not
 * caught: it only filters which files `--pre` runs on and executes nothing.
 *
 * Each command maps to a *list* of guards rather than one, because a command can
 * carry two unrelated escapes and a single `label` could only name one of them:
 * `sort` both writes a file (`-o`) and runs a program (`--compress-program`).
 *
 * `fd -t`/`-e` and `date -I`/`-d`/`-f`/`-r`/`-v` are the value-taking letters
 * whose own values collide with a guarded one — `fd -tx` is `--type executable`,
 * `fd -exml` an extension, `date -Iseconds` an ISO format, `date -dyesterday` a
 * relative date — so each is declared rather than refused. `date -d` matters on
 * Linux specifically: it is GNU-only, and BSD `date` rejects it, so a table
 * written against macOS alone would deny it on the platform where it works.
 * Each was confirmed to consume its value rather than fall through to `-s`.
 * `rg` needs none, its guards being long-only.
 *
 * The whole of {@link READ_ONLY_COMMANDS} was swept for this shape — an
 * allowlisted command carrying a flag whose *value* is a program or an output
 * path — against both the BSD binaries this machine ships and GNU coreutils.
 * `sort --compress-program` and `file -C` were what that sweep turned up;
 * `tests/shared/plan-mode-bash-guard.test.ts` pins the result so the next one
 * fails a test rather than reaching a report.
 */
const FLAG_GUARDED_COMMANDS: ReadonlyMap<string, readonly FlagGuard[]> =
	new Map([
		[
			'fd',
			[
				{
					flags: new Set(['--exec', '--exec-batch', '-X', '-x']),
					label: 'runs a command for every match',
					valueLetters: new Set(['e', 't']),
				},
			],
		],
		['file', [FILE_COMPILE_GUARD]],
		[
			'rg',
			[
				{
					flags: new Set(['--hostname-bin', '--pre']),
					label: 'runs a program for every file',
				},
			],
		],
		[
			'date',
			[
				{
					flags: new Set(['--set', '-s']),
					label: 'sets the system clock',
					valueLetters: new Set(['I', 'd', 'f', 'r', 'v']),
				},
			],
		],
		['sort', [SORT_OUTPUT_FILE_GUARD, SORT_COMPRESS_PROGRAM_GUARD]],
		['tree', [TREE_OUTPUT_FILE_GUARD]],
	]);

/**
 * Extra flag guards for individual read-only `git` subcommands, screened
 * alongside {@link GIT_OUTPUT_FILE_GUARD}. `git grep -O` hands every match to a
 * pager command of the caller's choosing, so it runs a program the classifier
 * cannot see. Its `valueLetters` is left empty because only `git grep -eO<term>`
 * collides — a pattern beginning with a capital `O` attached to `-e` — and the
 * same search spelled with a space does not.
 */
const GIT_SUBCOMMAND_FLAG_GUARDS: ReadonlyMap<string, FlagGuard> = new Map([
	[
		'grep',
		{
			flags: new Set(['--open-files-in-pager', '-O']),
			label: 'runs a pager program of its own',
		},
	],
]);

/**
 * Reads the letters a single-dash token clusters, stopping where an attached
 * value begins.
 *
 * Short options cluster (`-no` is `-n -o`) and take their value attached
 * (`-o/tmp/out`), so comparing a whole token against a flag set misses both and
 * every flag guard in this module was bypassable that way. The scan stops at the
 * first non-letter because a path or a number sharing the token cannot supply a
 * guarded letter: `sort -T/tmp/sort-work` names a scratch directory rather than
 * the `-o` its own spelling contains. An attached value that is *all* letters
 * needs `FlagGuard.valueLetters` instead.
 * @param token - One argument token.
 * @returns The clustered letters, empty when the token is not a short-flag group.
 */
function shortFlagLetters(token: string): string {
	if (!token.startsWith('-') || token.startsWith('--')) {
		return '';
	}
	return /^[A-Za-z]*/.exec(token.slice(1))?.[0] ?? '';
}

/**
 * Names the guarded flag a token carries across the four spellings these
 * commands accept: the flag alone, `--flag=value`, an unambiguous abbreviation
 * of the long name, and a short flag clustered with others or carrying an
 * attached value.
 *
 * Abbreviations are matched by prefix rather than enumerated, because git's
 * parse-options and getopt_long both accept any unambiguous truncation —
 * `sort --out=` writes the file and `git branch --unset-upst` retargets a ref.
 * Nothing shorter than one character after the dashes is considered, so a bare
 * `--` ends options rather than naming one.
 *
 * A guard's own {@link FlagGuard.valueLetters} stops the cluster scan where an
 * all-letter value begins. Without one for that letter, a value colliding with a
 * guarded letter is refused along with the real thing: the recoverable
 * direction, since the agent reads the reason and re-runs.
 * @param token - One argument token.
 * @param flags - The guarded flag spellings, long and short.
 * @param valueLetters - Short letters of this command that consume their value attached.
 * @returns The guarded flag the token names, or null when it names none.
 */
function guardedFlagIn(
	token: string,
	flags: ReadonlySet<string>,
	valueLetters?: ReadonlySet<string>,
): string | null {
	if (flags.has(token)) {
		return token;
	}
	if (token.startsWith('--')) {
		const equals = token.indexOf('=');
		const name = equals === -1 ? token : token.slice(0, equals);
		if (name.length <= 2) {
			return null;
		}
		return (
			[...flags].find(
				(flag) => flag.startsWith('--') && flag.startsWith(name),
			) ?? null
		);
	}
	for (const letter of shortFlagLetters(token)) {
		if (flags.has(`-${letter}`)) {
			return `-${letter}`;
		}
		if (valueLetters?.has(letter)) {
			return null;
		}
	}
	return null;
}

/**
 * Finds the first argument that trips a flag guard.
 * @param args - Tokens after the head word.
 * @param guard - The command's flag guard.
 * @returns The offending flag, or null when none is present.
 */
function findGuardedFlag(
	args: readonly string[],
	guard: FlagGuard,
): string | null {
	for (const token of args) {
		const flag = guardedFlagIn(token, guard.flags, guard.valueLetters);
		if (flag !== null) {
			return flag;
		}
	}
	return null;
}

/**
 * Names the variable a leading `FOO=bar` token assigns.
 * @param token - The segment's first token.
 * @returns The variable name, or null when the token is not an assignment.
 */
function assignedVariable(token: string): string | null {
	return ASSIGNMENT_PREFIX.exec(token)?.[1] ?? null;
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

/**
 * Classifies a `uniq` invocation, whose second positional argument is an output
 * file rather than a second input. `uniq in.txt notes.md` truncates `notes.md`
 * with no shell redirection for the `>` scan to catch, while the piped and
 * single-file forms only read.
 *
 * `--` ends the options, and everything after it is an operand however it is
 * spelled. Counting a leading dash as a flag past that point read
 * `uniq -- -input output` as one positional and let it truncate `output`, which
 * was verified against a file actually named `-input`.
 * @param args - Tokens after the `uniq` head word.
 * @returns Allowed while at most one positional names a file.
 */
function evaluateUniq(args: readonly string[]): BashGuardVerdict {
	let positionals = 0;
	let optionsEnded = false;
	let index = 0;
	while (index < args.length) {
		const token = args[index] ?? '';
		if (!optionsEnded && token === '--') {
			optionsEnded = true;
			index += 1;
			continue;
		}
		if (optionsEnded || !token.startsWith('-') || token === '-') {
			positionals += 1;
			index += 1;
			continue;
		}
		index += UNIQ_VALUE_FLAGS.has(token) ? 2 : 1;
	}
	return positionals > 1
		? deny('`uniq <input> <output>` writes its second argument to a file')
		: { ok: true };
}

/** The tokens at `git`'s subcommand, or the global flag that disqualified it. */
type GitGlobals = { rest: readonly string[] } | { violation: string };

/**
 * Reports whether a `git` global flag names a program for git to run.
 * @param flag - One global flag token, in either the bare or `--flag=value` form.
 * @returns True when the flag injects configuration or relocates git's helpers.
 */
function injectsGitProgram(flag: string): boolean {
	return guardedFlagIn(flag, GIT_PROGRAM_INJECTING_FLAGS) !== null;
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
 * Drops the values {@link GIT_BRANCH_VALUE_FLAGS} consume, leaving only the
 * tokens `git branch` and `git remote` read as arguments of their own.
 *
 * Scanning the raw list reads a value as an argument of its own, and a sort key
 * is spelled like a flag cluster: `--sort -committerdate` put a `c` in front of
 * the classifier, which matched the `-c` that copies a ref and denied a listing.
 *
 * The match runs through {@link guardedFlagIn} so an abbreviation consumes its
 * value too — git accepts `--forma '%(refname)'`, and matching the token exactly
 * read the format string as a second argument. Skipping is safe on the same
 * terms it is correct: every flag here consumes the next token in git as well,
 * including `--contains` and `--merged`, whose arguments are documented optional
 * but are taken from argv unless the flag is last. An attached `--format=…`
 * carries its own value and consumes nothing.
 * @param rest - Tokens after the subcommand.
 * @returns The tokens that are the command's own.
 */
function refArgumentsWithoutValues(rest: readonly string[]): string[] {
	const own: string[] = [];
	let index = 0;
	while (index < rest.length) {
		const token = rest[index] ?? '';
		own.push(token);
		const consumesValue =
			!token.includes('=') &&
			guardedFlagIn(token, GIT_BRANCH_VALUE_FLAGS) !== null;
		index += consumesValue ? 2 : 1;
	}
	return own;
}

/**
 * Reports whether `git branch` was handed a bare name, which creates or resets a
 * ref. `--list` marks its positional as a match pattern rather than a new name.
 * @param own - The branch arguments with flag values already dropped.
 * @returns True when a positional argument would write a ref.
 */
function createsGitBranch(own: readonly string[]): boolean {
	if (own.includes('--list')) {
		return false;
	}
	return own.some((token) => !token.startsWith('-'));
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
		GIT_OUTPUT_FILE_GUARD,
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
	const own = refArgumentsWithoutValues(rest);
	const mutation = own.find(
		(token) =>
			guardedFlagIn(token, GIT_REF_MUTATING_FLAGS) !== null ||
			(subcommand === 'remote' && GIT_REMOTE_MUTATING_SUBCOMMANDS.has(token)),
	);
	if (mutation !== undefined) {
		return deny(`\`git ${subcommand} ${mutation}\` mutates refs`);
	}
	if (subcommand === 'branch' && createsGitBranch(own)) {
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
 * runner (`fd -x`, `rg --pre`, `date -s`, `sort -o`, `sort --compress-program`,
 * `file -C`). Every guard the command carries is tried, so the denial names the
 * flag that actually fired rather than the first one declared.
 * @param head - The classified command.
 * @param args - Tokens after the head word.
 * @returns A denial when a guarded flag is present; null when the command is not
 *   flag-guarded or is used in its read-only form.
 */
function evaluateFlagGuard(
	head: string,
	args: readonly string[],
): BashGuardVerdict | null {
	for (const guard of FLAG_GUARDED_COMMANDS.get(head) ?? []) {
		const flag = findGuardedFlag(args, guard);
		if (flag !== null) {
			return deny(`\`${head} ${flag}\` ${guard.label}`);
		}
	}
	return null;
}

/**
 * Classifies one chained command from the full invocation.
 * @param segment - The lexed tokens of a single command between shell separators.
 * @returns Allowed when its head word is read-only, denied otherwise.
 */
function evaluateSegment(segment: readonly string[]): BashGuardVerdict {
	const head = segment[0];
	if (head === undefined) {
		return { ok: true };
	}
	const assigned = assignedVariable(head);
	if (assigned !== null) {
		return deny(
			`\`${assigned}=\` sets an environment variable, and a variable can name a program the command then runs: \`GIT_EXTERNAL_DIFF\` and \`GIT_CONFIG_GLOBAL\` execute during \`git diff\`, and \`PATH\` redirects the binary itself. Re-run without the assignment`,
		);
	}
	const args = segment.slice(1);
	if (head === 'find') {
		return evaluateFind(args);
	}
	if (head === 'git') {
		return evaluateGit(args);
	}
	if (head === 'gh') {
		return evaluateGh(args);
	}
	if (head === 'uniq') {
		return evaluateUniq(args);
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
