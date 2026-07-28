/**
 * Read-only classifier for `bash` commands an agent issues while its
 * conversation is in Plan Mode. Deny by default: a false block is recoverable —
 * the agent reads the reason and adapts — while a false allow silently mutates
 * the user's repository, which is the whole thing Plan Mode exists to prevent.
 */

/** Outcome of classifying a command: allowed, or denied with a reason. */
export type BashGuardVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Commands that only read. Deliberately small — it grows from real usage rather
 * than from guessing what an agent might want.
 */
const READ_ONLY_COMMANDS: ReadonlySet<string> = new Set([
	'basename',
	'cat',
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

/**
 * Redirection tokens that discard output rather than write a file. Ordered
 * longest-first so stripping never leaves a dangling fragment behind.
 */
const DISCARD_REDIRECTIONS = ['2>/dev/null', '2>&1', '>/dev/null'] as const;

/** Shell constructs that reach past the classified command, matched after stripping discards. */
const FORBIDDEN_CONSTRUCTS: readonly { pattern: RegExp; label: string }[] = [
	{ label: 'command substitution `$(…)`', pattern: /\$\(/ },
	{ label: 'command substitution with backticks', pattern: /`/ },
	{ label: 'process substitution `<(…)`', pattern: /<\(/ },
	{ label: 'heredoc input `<<`', pattern: /<</ },
	{ label: 'output redirection `>`', pattern: />/ },
];

/** Separators that chain several commands into one bash invocation. */
const SEGMENT_SEPARATORS = /&&|\|\||;|\||\n|&/;

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
	'describe',
	'diff',
	'log',
	'ls-files',
	'merge-base',
	'rev-parse',
	'shortlog',
	'show',
	'status',
]);

/** `git branch` / `git remote` flags that mutate rather than list. */
const GIT_REF_MUTATING_FLAGS: ReadonlySet<string> = new Set([
	'--copy',
	'--delete',
	'--move',
	'--set-upstream-to',
	'-C',
	'-D',
	'-M',
	'-d',
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
	'-c',
]);

/**
 * Flags that send a command's output to a file instead of stdout. `sort -o`,
 * `tree -o`, and `git diff --output=` each write a file without any shell
 * redirection, so the `>` scan never sees them.
 */
const OUTPUT_FILE_FLAGS: ReadonlySet<string> = new Set(['--output', '-o']);

const ASSIGNMENT_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Finds an output-to-file flag among a command's arguments.
 * @param args - Tokens after the head word.
 * @returns The offending flag, or null when the command only writes to stdout.
 */
function findOutputFlag(args: readonly string[]): string | null {
	return (
		args.find(
			(token) => OUTPUT_FILE_FLAGS.has(token) || token.startsWith('--output='),
		) ?? null
	);
}

/**
 * Removes the discard-only redirection tokens so the forbidden-construct scan
 * and the segment split both see a command free of their `>` and `&`.
 * @param command - Raw command text.
 * @returns The command with discard redirections blanked out.
 */
function stripDiscardRedirections(command: string): string {
	return DISCARD_REDIRECTIONS.reduce(
		(text, token) => text.split(token).join(' '),
		command,
	);
}

/**
 * Splits a segment into whitespace-separated tokens, dropping leading
 * `FOO=bar` environment assignments.
 * @param segment - One chained command from the full invocation.
 * @returns The segment's tokens with assignments removed.
 */
function tokenize(segment: string): readonly string[] {
	const tokens = segment.trim().split(/\s+/).filter(Boolean);
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

/**
 * Drops `git`'s global flags (and the values they consume) to reach the
 * subcommand.
 * @param args - Tokens after the `git` head word.
 * @returns The tokens starting at the subcommand.
 */
function skipGitGlobalFlags(args: readonly string[]): readonly string[] {
	let index = 0;
	while (index < args.length && (args[index] ?? '').startsWith('-')) {
		index += GIT_VALUE_FLAGS.has(args[index] ?? '') ? 2 : 1;
	}
	return args.slice(index);
}

/**
 * Classifies a `git` invocation against the read-only subcommand allowlist,
 * with narrower rules for the subcommands that both read and write.
 * @param args - Tokens after the `git` head word.
 * @returns Allowed only for inspection subcommands.
 */
function evaluateGit(args: readonly string[]): BashGuardVerdict {
	const [subcommand, ...rest] = skipGitGlobalFlags(args);
	if (!subcommand) {
		return deny('`git` needs a read-only subcommand in Plan Mode');
	}
	if (GIT_READ_SUBCOMMANDS.has(subcommand)) {
		const outputFlag = findOutputFlag(rest);
		return outputFlag === null
			? { ok: true }
			: deny(`\`git ${subcommand} ${outputFlag}\` writes its output to a file`);
	}
	if (subcommand === 'branch' || subcommand === 'remote') {
		const mutation = rest.find(
			(token) =>
				GIT_REF_MUTATING_FLAGS.has(token) ||
				(subcommand === 'remote' && GIT_REMOTE_MUTATING_SUBCOMMANDS.has(token)),
		);
		return mutation === undefined
			? { ok: true }
			: deny(`\`git ${subcommand} ${mutation}\` mutates refs`);
	}
	if (subcommand === 'config') {
		return rest.some((token) => GIT_CONFIG_READ_FLAGS.has(token))
			? { ok: true }
			: deny('`git config` is read-only in Plan Mode with `--get` or `--list`');
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
 * Classifies one chained command from the full invocation.
 * @param segment - A single command between shell separators.
 * @returns Allowed when its head word is read-only, denied otherwise.
 */
function evaluateSegment(segment: string): BashGuardVerdict {
	const tokens = tokenize(segment);
	const head = tokens[0];
	if (head === undefined) {
		return { ok: true };
	}
	const args = tokens.slice(1);
	if (READ_ONLY_COMMANDS.has(head)) {
		const outputFlag = findOutputFlag(args);
		return outputFlag === null
			? { ok: true }
			: deny(`\`${head} ${outputFlag}\` writes its output to a file`);
	}
	if (head === 'find') {
		return evaluateFind(args);
	}
	if (head === 'git') {
		return evaluateGit(args);
	}
	if (head === 'gh') {
		return evaluateGh(args);
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
	const sanitized = stripDiscardRedirections(command);
	if (sanitized.trim().length === 0) {
		return deny('an empty command cannot be classified as read-only');
	}
	const construct = FORBIDDEN_CONSTRUCTS.find((entry) =>
		entry.pattern.test(sanitized),
	);
	if (construct) {
		return deny(`${construct.label} can write files or run other commands`);
	}
	for (const segment of sanitized.split(SEGMENT_SEPARATORS)) {
		const verdict = evaluateSegment(segment);
		if (!verdict.ok) {
			return verdict;
		}
	}
	return { ok: true };
}
