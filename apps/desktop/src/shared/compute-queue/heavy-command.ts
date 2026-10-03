/**
 * Decides which shell commands are compute-heavy enough to go through the
 * app-wide compute queue rather than an agent's own shell.
 *
 * A pattern names a command the way a person types it — `vitest`, `cargo
 * test`, `run build*` — and a command line matches when any simple command in
 * it, once its wrappers are peeled away, starts with the pattern's tokens. The
 * peeling is the substance: agents reach the same test runner as `bun run
 * test`, `cd apps/desktop && bun run test 2>&1 | tail`, `bunx vitest run`,
 * `env CI=1 npx -y vitest`, or `bash -lc 'bun run test'`, and a prefix match on
 * the raw text catches the first of those and none of the rest.
 *
 * Package-manager scripts are read into one `run <script>` form whichever
 * manager runs them, so one `run test*` pattern covers `bun run test`,
 * `npm test`, `pnpm test:unit` and `yarn test`. Built-in subcommands keep their
 * manager's name, which is what keeps `bun test` (Bun's own runner) apart from
 * `bun run test` (a script) and `bun install` out of the queue entirely.
 *
 * Unreadable input fails open: a command whose quotes do not balance is not
 * classified heavy, because the shell would refuse to run it anyway.
 */
import type { ComputeQueueSettings } from '../config.ts';
import { lexCommandSegments } from '../plan-mode.ts';

/**
 * The commands the queue holds by default: test runners, type checkers,
 * builds, compiles, and system rebuilds. Installs and quick tools stay out —
 * queueing `git status` behind a ten-minute build would make the machine
 * slower to use, which is the opposite of the queue's purpose.
 */
export const DEFAULT_HEAVY_COMMAND_PATTERNS: readonly string[] = [
	'run test*',
	'run build*',
	'run typecheck*',
	'run check*',
	'run lint*',
	'run make*',
	'run package*',
	'run dist*',
	'run e2e*',
	'run compile*',
	'bun test',
	'bun build',
	'vitest',
	'jest',
	'playwright test',
	'pytest',
	'tox',
	'nox',
	'rspec',
	'deno test',
	'deno compile',
	'tsc',
	'tsgo',
	'vue-tsc',
	'eslint',
	'mypy',
	'pyright',
	'cargo build',
	'cargo test',
	'cargo check',
	'cargo clippy',
	'cargo nextest',
	'cargo bench',
	'go build',
	'go test',
	'make',
	'cmake --build',
	'ctest',
	'ninja',
	'meson compile',
	'gradle',
	'gradlew',
	'mvn',
	'mvnw',
	'sbt',
	'dotnet build',
	'dotnet test',
	'xcodebuild',
	'swift build',
	'swift test',
	'zig build',
	'bazel build',
	'bazel test',
	'cabal build',
	'stack build',
	'mix compile',
	'mix test',
	'turbo',
	'nx',
	'electron-forge',
	'electron-builder',
	'vite build',
	'next build',
	'nuxt build',
	'astro build',
	'webpack',
	'docker build',
	'docker buildx build',
	'docker compose build',
	'docker-compose build',
	'podman build',
	'nix build',
	'nix flake check',
	'nix-build',
	'nixos-rebuild',
	'darwin-rebuild',
	'home-manager switch',
	'home-manager build',
	'nh os',
	'nh home',
	'nh darwin',
];

/** Whether a command must go through the queue, and the pattern that said so. */
export type HeavyCommandVerdict =
	| { heavy: false }
	| { heavy: true; matched: string };

/** The user's adjustments to the default pattern list. */
interface HeavyCommandPatterns {
	extraPatterns?: readonly string[];
	exemptPatterns?: readonly string[];
}

/** A command's argument vector at some stage of normalisation. */
type Tokens = readonly string[];

/** One pattern, kept as written for the verdict and compiled to a matcher per token. */
interface CompiledPattern {
	source: string;
	tokens: readonly RegExp[];
}

/** The compiled lists one classification runs against. */
interface CompiledRules {
	heavy: readonly CompiledPattern[];
	exempt: readonly CompiledPattern[];
}

/** The result of peeling one layer: the remaining argv, and whether it is final. */
interface Unwrapped {
	tokens: Tokens;
	settled: boolean;
}

/** A command another command runs: a string to lex, or an argv to classify as-is. */
type NestedCommand = { text: string } | { argv: Tokens };

const NOT_HEAVY: HeavyCommandVerdict = { heavy: false };

/** How many shells deep a `bash -c` or `nix develop -c` is followed. */
const MAX_NESTING_DEPTH = 3;

/** Bound on wrapper layers peeled from one command, so no input can loop. */
const MAX_UNWRAP_PASSES = 16;

/** A leading `NAME=value` assignment, which sets the environment rather than naming a command. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Every spelling of a Python interpreter: `python`, `python3`, `python3.12`. */
const PYTHON = /^python[0-9.]*$/;

/** A shell option cluster that carries `-c`, as in `-c`, `-lc`, `-ec`. */
const SHELL_COMMAND_FLAG = /^-[A-Za-z]*c[A-Za-z]*$/;

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

/** Shells whose `-c` argument is itself a command line. */
const SHELLS: ReadonlySet<string> = new Set([
	'bash',
	'dash',
	'fish',
	'ksh',
	'sh',
	'zsh',
]);

/** Shell options that consume the next word, which is therefore not a script. */
const SHELL_VALUE_FLAGS: ReadonlySet<string> = new Set([
	'+O',
	'+o',
	'-O',
	'-o',
	'--init-file',
	'--rcfile',
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
function normaliseTokens(tokens: Tokens): Tokens {
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
 * Finds the command a Nix development shell runs: the argv after `nix develop`
 * or `nix shell`'s `-c`/`--command`, or the string after `nix-shell --run`.
 * @param name - The normalised command name.
 * @param rest - Its argv.
 * @returns The nested command, or null when the shell runs nothing given here.
 */
function nixShellCommand(name: string, rest: Tokens): NestedCommand | null {
	if (name === 'nix') {
		const verbAt = rest.findIndex(
			(token) => token === 'develop' || token === 'shell',
		);
		const commandAt = rest.findIndex(
			(token) => token === '-c' || token === '--command',
		);
		return verbAt !== -1 && commandAt > verbAt
			? { argv: rest.slice(commandAt + 1) }
			: null;
	}
	if (name === 'nix-shell') {
		const runAt = rest.findIndex(
			(token) => token === '--run' || token === '--command',
		);
		const text = runAt === -1 ? undefined : rest[runAt + 1];
		return text === undefined ? null : { text };
	}
	return null;
}

/**
 * Finds the command a normalised command runs inside itself, if any.
 * @param tokens - The normalised argv.
 * @returns The nested command, or null when there is none.
 */
function nestedCommand(tokens: Tokens): NestedCommand | null {
	const [name = '', ...rest] = tokens;
	if (SHELLS.has(name)) {
		const text = shellCommandString(rest);
		return text === null ? null : { text };
	}
	return nixShellCommand(name, rest);
}

/**
 * Lists the forms a normalised command is matched in. A `run <name>` may be a
 * script or, where no script has the name, the package's binary of that name —
 * `bun run tsc`, `pnpm vitest` — so both forms are tried.
 * @param tokens - The normalised argv.
 * @returns The forms to match patterns against.
 */
function candidateForms(tokens: Tokens): readonly Tokens[] {
	return tokens[0] === 'run' && tokens.length > 1
		? [tokens, tokens.slice(1)]
		: [tokens];
}

/**
 * Compiles one pattern token, in which `*` matches any run of characters.
 * @param token - The pattern token.
 * @returns An anchored matcher for one command token.
 */
function globToRegExp(token: string): RegExp {
	const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`^${escaped.replaceAll('\\*', '.*')}$`);
}

/**
 * Compiles a pattern, normalising its tokens as a command's are so a pattern
 * written `bun run lint` or `npx eslint` means what it says.
 * @param source - The pattern as written.
 * @returns The compiled pattern, or null when it names no command.
 */
function compilePattern(source: string): CompiledPattern | null {
	const words = source.trim().split(/\s+/).filter(Boolean);
	const tokens = normaliseTokens(words);
	return tokens.length === 0
		? null
		: { source, tokens: tokens.map(globToRegExp) };
}

/**
 * Compiles a list of patterns, dropping any that name no command.
 * @param sources - The patterns as written.
 * @returns The compiled patterns.
 */
function compilePatterns(sources: readonly string[]): CompiledPattern[] {
	return sources.flatMap((source) => compilePattern(source) ?? []);
}

/**
 * Reports whether a command's tokens start with a pattern's.
 * @param pattern - The compiled pattern.
 * @param tokens - One candidate form of a normalised command.
 * @returns True when every pattern token matches the command token in its place.
 */
function matchesPattern(pattern: CompiledPattern, tokens: Tokens): boolean {
	return (
		pattern.tokens.length <= tokens.length &&
		pattern.tokens.every((matcher, index) =>
			matcher.test(tokens[index] as string),
		)
	);
}

/**
 * Classifies one simple command, following any command it runs inside itself.
 * @param tokens - The simple command's argv.
 * @param rules - The compiled pattern lists.
 * @param depth - How many shells deep this command sits.
 * @returns The verdict for this command.
 */
function classifySegment(
	tokens: Tokens,
	rules: CompiledRules,
	depth: number,
): HeavyCommandVerdict {
	const forms = candidateForms(normaliseTokens(tokens));
	const exempt = forms.some((form) =>
		rules.exempt.some((pattern) => matchesPattern(pattern, form)),
	);
	if (exempt) {
		return NOT_HEAVY;
	}
	const nested =
		depth < MAX_NESTING_DEPTH ? nestedCommand(forms[0] ?? []) : null;
	if (nested) {
		const inner =
			'text' in nested
				? classifyCommandText(nested.text, rules, depth + 1)
				: classifySegment(nested.argv, rules, depth + 1);
		if (inner.heavy) {
			return inner;
		}
	}
	for (const form of forms) {
		const hit = rules.heavy.find((pattern) => matchesPattern(pattern, form));
		if (hit) {
			return { heavy: true, matched: hit.source };
		}
	}
	return NOT_HEAVY;
}

/**
 * Classifies a command line by the first heavy simple command in it.
 * @param command - The command line.
 * @param rules - The compiled pattern lists.
 * @param depth - How many shells deep this line sits.
 * @returns The verdict for the line.
 */
function classifyCommandText(
	command: string,
	rules: CompiledRules,
	depth: number,
): HeavyCommandVerdict {
	for (const segment of lexCommandSegments(command) ?? []) {
		const verdict = classifySegment(segment, rules, depth);
		if (verdict.heavy) {
			return verdict;
		}
	}
	return NOT_HEAVY;
}

/**
 * Decides whether a shell command is compute-heavy and must go through the
 * queue. Exempt patterns win over every match, the defaults' included.
 * @param command - The command line an agent asked to run.
 * @param patterns - Patterns to add to the defaults, and patterns to exempt.
 * @returns The verdict, naming the matched pattern when heavy.
 */
export function classifyHeavyCommand(
	command: string,
	patterns: HeavyCommandPatterns = {},
): HeavyCommandVerdict {
	const rules: CompiledRules = {
		exempt: compilePatterns(patterns.exemptPatterns ?? []),
		heavy: compilePatterns([
			...DEFAULT_HEAVY_COMMAND_PATTERNS,
			...(patterns.extraPatterns ?? []),
		]),
	};
	return classifyCommandText(command, rules, 0);
}

/**
 * Classifies a command under the user's compute-queue settings: nothing is
 * heavy while the queue is off, and otherwise the settings' extra and exempt
 * patterns adjust the defaults.
 * @param command - The command line an agent asked to run.
 * @param settings - The live compute-queue settings.
 * @returns The verdict, naming the matched pattern when heavy.
 */
export function classifyHeavyCommandForSettings(
	command: string,
	settings: ComputeQueueSettings,
): HeavyCommandVerdict {
	return settings.enabled
		? classifyHeavyCommand(command, {
				exemptPatterns: settings.exemptPatterns,
				extraPatterns: settings.extraPatterns,
			})
		: NOT_HEAVY;
}
