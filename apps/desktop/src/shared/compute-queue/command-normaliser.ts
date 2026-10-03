/**
 * Reads one simple command down to the command it actually runs, for the
 * heavy-command classifier: leading assignments and keywords are dropped, a
 * path on the command name is reduced to the name, and every wrapper, runner,
 * and package manager in front is peeled away.
 *
 * Package-manager scripts are read into one `run <script>` form whichever
 * manager runs them, so one `run test*` pattern covers `bun run test`,
 * `npm test`, `pnpm test:unit` and `yarn test`. Built-in subcommands keep their
 * manager's name, which is what keeps `bun test` (Bun's own runner) apart from
 * `bun run test` (a script) and `bun install` out of the queue entirely.
 */

/** A command's argument vector at some stage of normalisation. */
export type Tokens = readonly string[];

/** The result of peeling one layer: the remaining argv, and whether it is final. */
interface Unwrapped {
	tokens: Tokens;
	settled: boolean;
}

/** Bound on wrapper layers peeled from one command, so no input can loop. */
const MAX_UNWRAP_PASSES = 16;

/** A leading `NAME=value` assignment, which sets the environment rather than naming a command. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Every spelling of a Python interpreter: `python`, `python3`, `python3.12`. */
const PYTHON = /^python[0-9.]*$/;

/** Reserved words that may open a simple command without being its name. */
const LEADING_KEYWORDS: ReadonlySet<string> = new Set([
	'!',
	'do',
	'elif',
	'else',
	'if',
	'then',
	'until',
	'while',
]);

const NO_VALUE_FLAGS: ReadonlySet<string> = new Set();

/** Options of `bunx`, `npx`, `pnpx` and the managers' exec verbs that take a value. */
const RUNNER_VALUE_FLAGS: ReadonlySet<string> = new Set([
	'-c',
	'--call',
	'-p',
	'--package',
]);

/**
 * Skips the options in front of a command's operand, along with the values of
 * the options that take one, stopping after a `--`.
 * @param tokens - The argv after the command that owns the options.
 * @param valueFlags - The options whose next word is their value.
 * @param skipsAssignments - Whether `NAME=value` words are skipped too, as `env` takes them.
 * @returns The argv from the first operand on.
 */
function skipOptions(
	tokens: Tokens,
	valueFlags: ReadonlySet<string>,
	skipsAssignments = false,
): Tokens {
	let index = 0;
	while (index < tokens.length) {
		const token = tokens[index] as string;
		if (token === '--') {
			return tokens.slice(index + 1);
		}
		if (skipsAssignments && ASSIGNMENT.test(token)) {
			index += 1;
			continue;
		}
		if (!token.startsWith('-') || token === '-') {
			break;
		}
		index += valueFlags.has(token) ? 2 : 1;
	}
	return tokens.slice(index);
}

/**
 * Builds a wrapper reader that skips the wrapper's options and runs what follows.
 * @param valueFlags - The wrapper's options that take a value.
 * @param skipsAssignments - Whether the wrapper also takes `NAME=value` words.
 * @returns The reader for the wrapper's argv.
 */
function optionsThenCommand(
	valueFlags: readonly string[],
	skipsAssignments = false,
): (rest: Tokens) => Tokens {
	const flags = new Set(valueFlags);
	return (rest) => skipOptions(rest, flags, skipsAssignments);
}

/**
 * Reads `python -m module …` as the module's own command line.
 * @param rest - The interpreter's argv.
 * @returns The module's argv, or null when the interpreter runs a script or inline code.
 */
function readPythonModule(rest: Tokens): Tokens | null {
	for (const [index, token] of rest.entries()) {
		if (token === '-m') {
			return rest.slice(index + 1);
		}
		if (token.startsWith('-m')) {
			return [token.slice(2), ...rest.slice(index + 1)];
		}
		if (!token.startsWith('-') || token === '-c') {
			return null;
		}
	}
	return null;
}

/**
 * Reads a `<tool> run …` runner, such as `uv run pytest`, as the command it runs.
 * @param valueFlags - The runner's options that take a value.
 * @returns The reader, which answers null when the tool is not running a command.
 */
function runVerb(
	valueFlags: readonly string[],
): (rest: Tokens) => Tokens | null {
	const flags = new Set(valueFlags);
	return (rest) =>
		rest[0] === 'run' ? skipOptions(rest.slice(1), flags) : null;
}

/**
 * Commands that run another command, keyed by name, each reading its own argv
 * down to the command it runs. A reader answering null means this invocation
 * runs nothing further and the argv is final as it stands; an empty argv means
 * it runs nothing at all, as `command -v make` only looks `make` up.
 */
const WRAPPERS: ReadonlyMap<string, (rest: Tokens) => Tokens | null> = new Map<
	string,
	(rest: Tokens) => Tokens | null
>([
	['bunx', optionsThenCommand([...RUNNER_VALUE_FLAGS])],
	[
		'command',
		(rest) =>
			rest.some((token) => token === '-v' || token === '-V')
				? []
				: skipOptions(rest, NO_VALUE_FLAGS),
	],
	['doas', optionsThenCommand(['-C', '-u'])],
	[
		'env',
		optionsThenCommand(
			['-C', '--chdir', '-S', '--split-string', '-u', '--unset'],
			true,
		),
	],
	['exec', optionsThenCommand(['-a'])],
	[
		'ionice',
		optionsThenCommand(['-c', '--class', '-n', '--classdata', '-p', '--pid']),
	],
	['nice', optionsThenCommand(['-n', '--adjustment'])],
	['nohup', optionsThenCommand([])],
	['npx', optionsThenCommand([...RUNNER_VALUE_FLAGS])],
	['pnpx', optionsThenCommand([...RUNNER_VALUE_FLAGS])],
	['poetry', runVerb([])],
	['python', readPythonModule],
	['stdbuf', optionsThenCommand(['-e', '-i', '-o'])],
	[
		'sudo',
		optionsThenCommand([
			'-C',
			'-D',
			'-g',
			'-h',
			'-p',
			'-r',
			'-T',
			'-t',
			'-U',
			'-u',
			'--chdir',
			'--group',
			'--host',
			'--prompt',
			'--user',
		]),
	],
	['time', optionsThenCommand(['-f', '--format', '-o', '--output'])],
	[
		'timeout',
		(rest) =>
			skipOptions(
				rest,
				new Set(['-k', '--kill-after', '-s', '--signal']),
			).slice(1),
	],
	[
		'uv',
		runVerb([
			'--directory',
			'--env-file',
			'--extra',
			'--group',
			'--package',
			'--project',
			'-p',
			'--python',
			'--with',
		]),
	],
	[
		'xargs',
		optionsThenCommand(['-a', '-d', '-E', '-I', '-L', '-n', '-P', '-s']),
	],
]);

/**
 * How one package manager's command line reads: which verbs run a script, which
 * run a binary, which alias `run test`, and which are its own built-ins. A
 * `builtins` of null means every other verb is a built-in, as npm runs no
 * script without `run`.
 */
interface PackageManagerGrammar {
	builtins: ReadonlySet<string> | null;
	execVerbs: ReadonlySet<string>;
	runVerbs: ReadonlySet<string>;
	scopeVerbs: ReadonlySet<string>;
	testVerbs: ReadonlySet<string>;
	valueFlags: ReadonlySet<string>;
}

/** Options every manager shares that take a value: where to run, and which packages. */
const SHARED_PACKAGE_MANAGER_VALUE_FLAGS = [
	'-C',
	'--config',
	'--cwd',
	'--dir',
	'--env-file',
	'-F',
	'--filter',
	'--prefix',
	'--workspace',
];

/**
 * Builds a grammar from plain lists.
 * @param grammar - The verb and flag lists, as arrays.
 * @returns The grammar, with each list as a set.
 */
function grammarOf(grammar: {
	builtins: readonly string[] | null;
	execVerbs: readonly string[];
	extraValueFlags?: readonly string[];
	runVerbs: readonly string[];
	scopeVerbs?: readonly string[];
	testVerbs?: readonly string[];
}): PackageManagerGrammar {
	return {
		builtins: grammar.builtins ? new Set(grammar.builtins) : null,
		execVerbs: new Set(grammar.execVerbs),
		runVerbs: new Set(grammar.runVerbs),
		scopeVerbs: new Set(grammar.scopeVerbs),
		testVerbs: new Set(grammar.testVerbs),
		valueFlags: new Set([
			...SHARED_PACKAGE_MANAGER_VALUE_FLAGS,
			...(grammar.extraValueFlags ?? []),
		]),
	};
}

/** Each package manager's grammar, keyed by its command name. */
const PACKAGE_MANAGERS: ReadonlyMap<string, PackageManagerGrammar> = new Map([
	[
		'bun',
		grammarOf({
			builtins: [
				'a',
				'add',
				'audit',
				'build',
				'c',
				'ci',
				'completions',
				'create',
				'exec',
				'help',
				'i',
				'info',
				'init',
				'install',
				'link',
				'outdated',
				'patch',
				'pm',
				'publish',
				'remove',
				'repl',
				'rm',
				'test',
				'unlink',
				'update',
				'upgrade',
				'why',
			],
			execVerbs: ['x'],
			extraValueFlags: ['--preload', '-r'],
			runVerbs: ['run'],
		}),
	],
	[
		'npm',
		grammarOf({
			builtins: null,
			execVerbs: ['exec', 'x'],
			extraValueFlags: ['--userconfig', '-w'],
			runVerbs: ['run', 'run-script', 'rum', 'urn'],
			testVerbs: ['t', 'test', 'tst'],
		}),
	],
	[
		'pnpm',
		grammarOf({
			builtins: [
				'add',
				'audit',
				'config',
				'create',
				'deploy',
				'env',
				'fetch',
				'i',
				'import',
				'init',
				'install',
				'licenses',
				'link',
				'list',
				'ls',
				'outdated',
				'pack',
				'patch',
				'prune',
				'publish',
				'rebuild',
				'remove',
				'rm',
				'setup',
				'store',
				'unlink',
				'up',
				'update',
				'why',
			],
			execVerbs: ['dlx', 'exec'],
			runVerbs: ['run', 'run-script'],
			testVerbs: ['t', 'test', 'tst'],
		}),
	],
	[
		'yarn',
		grammarOf({
			builtins: [
				'add',
				'bin',
				'cache',
				'config',
				'constraints',
				'create',
				'dedupe',
				'explain',
				'info',
				'init',
				'install',
				'link',
				'node',
				'npm',
				'pack',
				'patch',
				'plugin',
				'publish',
				'remove',
				'set',
				'unlink',
				'up',
				'upgrade',
				'version',
				'why',
				'workspaces',
			],
			execVerbs: ['dlx', 'exec'],
			runVerbs: ['run'],
			scopeVerbs: ['workspace'],
		}),
	],
]);

/**
 * Reads a package manager's argv into the command it runs: `run <script> …`
 * for a script, the binary's own argv for an exec verb, and `<manager> <verb>`
 * for a built-in.
 * @param manager - The manager's command name.
 * @param grammar - The manager's grammar.
 * @param rest - The argv after the manager's name.
 * @returns The normalised argv, settled unless an exec verb hands it a binary to unwrap further.
 */
function readPackageManager(
	manager: string,
	grammar: PackageManagerGrammar,
	rest: Tokens,
): Unwrapped {
	let args = skipOptions(rest, grammar.valueFlags);
	while (args[0] !== undefined && grammar.scopeVerbs.has(args[0])) {
		args = skipOptions(args.slice(2), grammar.valueFlags);
	}
	const [verb, ...tail] = args;
	if (verb === undefined) {
		return { settled: true, tokens: [manager] };
	}
	if (grammar.runVerbs.has(verb)) {
		return {
			settled: true,
			tokens: ['run', ...skipOptions(tail, grammar.valueFlags)],
		};
	}
	if (grammar.execVerbs.has(verb)) {
		return { settled: false, tokens: skipOptions(tail, RUNNER_VALUE_FLAGS) };
	}
	if (grammar.testVerbs.has(verb)) {
		return { settled: true, tokens: ['run', 'test', ...tail] };
	}
	const builtin = grammar.builtins === null || grammar.builtins.has(verb);
	return {
		settled: true,
		tokens: builtin ? [manager, verb, ...tail] : ['run', verb, ...tail],
	};
}

/**
 * Reduces a path-qualified command to the name it is known by.
 * @param command - The command word, possibly a path.
 * @returns The final path segment, folded to `python` for any interpreter version.
 */
function commandName(command: string): string {
	const name = command.slice(command.lastIndexOf('/') + 1);
	return PYTHON.test(name) ? 'python' : name;
}

/**
 * Peels one layer off a command: leading assignments and keywords, a path on
 * the command name, or a wrapper, runner, or package manager in front.
 * @param tokens - The argv to peel.
 * @returns The remaining argv, settled once nothing further can be peeled.
 */
function unwrapOnce(tokens: Tokens): Unwrapped {
	const commandAt = tokens.findIndex(
		(token) => !ASSIGNMENT.test(token) && !LEADING_KEYWORDS.has(token),
	);
	if (commandAt !== 0) {
		return {
			settled: commandAt === -1,
			tokens: commandAt === -1 ? [] : tokens.slice(commandAt),
		};
	}
	const [first = '', ...rest] = tokens;
	const name = commandName(first);
	if (name !== first) {
		return { settled: false, tokens: [name, ...rest] };
	}
	const grammar = PACKAGE_MANAGERS.get(name);
	if (grammar) {
		return readPackageManager(name, grammar, rest);
	}
	const unwrapped = WRAPPERS.get(name)?.(rest);
	return unwrapped
		? { settled: false, tokens: unwrapped }
		: { settled: true, tokens };
}

/**
 * Peels every wrapper layer off a command until only the command it runs is left.
 * @param tokens - One simple command's argv.
 * @returns The normalised argv.
 */
export function normaliseTokens(tokens: Tokens): Tokens {
	let current = tokens;
	for (let pass = 0; pass < MAX_UNWRAP_PASSES; pass += 1) {
		const next = unwrapOnce(current);
		if (next.settled) {
			return next.tokens;
		}
		current = next.tokens;
	}
	return current;
}
