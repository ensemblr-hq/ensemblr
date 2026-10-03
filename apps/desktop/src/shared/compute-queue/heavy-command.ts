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
 * The peeling lives in `command-normaliser.ts` and the default patterns in
 * `heavy-command-patterns.ts`; this module follows nested commands — a shell's
 * `-c`, a Nix shell's command, a script fed to a shell's stdin — and matches.
 *
 * Unreadable input fails open: a command whose quotes do not balance is not
 * classified heavy, because the shell would refuse to run it anyway.
 */
import type { ComputeQueueSettings } from '../config.ts';
import { lexShellSegments, type ShellSegment } from '../plan-mode.ts';
import { normaliseTokens, type Tokens } from './command-normaliser.ts';
import { DEFAULT_HEAVY_COMMAND_PATTERNS } from './heavy-command-patterns.ts';

/** Whether a command must go through the queue, and the pattern that said so. */
export type HeavyCommandVerdict =
	| { heavy: false }
	| { heavy: true; matched: string };

/** The user's adjustments to the default pattern list. */
interface HeavyCommandPatterns {
	extraPatterns?: readonly string[];
	exemptPatterns?: readonly string[];
}

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

/** A command another command runs: a string to lex, or an argv to classify as-is. */
type NestedCommand = { text: string } | { argv: Tokens };

const NOT_HEAVY: HeavyCommandVerdict = { heavy: false };

/** How many shells deep a `bash -c` or `nix develop -c` is followed. */
const MAX_NESTING_DEPTH = 3;

/** A shell option cluster that carries `-c`, as in `-c`, `-lc`, `-ec`. */
const SHELL_COMMAND_FLAG = /^-[A-Za-z]*c[A-Za-z]*$/;

/** A shell option cluster that carries `-s`, which reads the script from stdin. */
const STDIN_SCRIPT_FLAG = /^-[A-Za-z]*s[A-Za-z]*$/;

/** `echo`'s own options, which it does not print. */
const ECHO_FLAGS = /^-[neE]+$/;

/** Shells whose `-c` argument, or stdin, is itself a command line. */
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
 * Finds the script a segment's stdin carries: its own heredoc or here-string,
 * or whatever the segment before it pipes in — that one's document, or the
 * text it echoes.
 * @param segments - Every segment of the command line.
 * @param index - The segment whose stdin to read.
 * @returns The text on its stdin, or null when none is known.
 */
function stdinText(
	segments: readonly ShellSegment[],
	index: number,
): string | null {
	const segment = segments[index];
	const feeder = index > 0 ? segments[index - 1] : undefined;
	if (segment?.stdin != null) {
		return segment.stdin;
	}
	return feeder?.pipesOnward
		? (feeder.stdin ?? echoedText(feeder.tokens))
		: null;
}

/**
 * Finds the command a normalised command runs inside itself, if any: a
 * shell's `-c` string, the script a shell reads from stdin, or a Nix shell's
 * command.
 * @param tokens - The normalised argv.
 * @param stdin - The text fed to the command's stdin, if known.
 * @returns The nested command, or null when there is none.
 */
function nestedCommand(
	tokens: Tokens,
	stdin: string | null,
): NestedCommand | null {
	const [name = '', ...rest] = tokens;
	if (!SHELLS.has(name)) {
		return nixShellCommand(name, rest);
	}
	const text = shellCommandString(rest);
	if (text !== null) {
		return { text };
	}
	return stdin !== null && shellReadsStdin(rest) ? { text: stdin } : null;
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
 * @param stdin - The text fed to the command's stdin, if known.
 * @returns The verdict for this command.
 */
function classifySegment(
	tokens: Tokens,
	rules: CompiledRules,
	depth: number,
	stdin: string | null,
): HeavyCommandVerdict {
	const forms = candidateForms(normaliseTokens(tokens));
	const exempt = forms.some((form) =>
		rules.exempt.some((pattern) => matchesPattern(pattern, form)),
	);
	if (exempt) {
		return NOT_HEAVY;
	}
	const nested =
		depth < MAX_NESTING_DEPTH ? nestedCommand(forms[0] ?? [], stdin) : null;
	if (nested) {
		const inner =
			'text' in nested
				? classifyCommandText(nested.text, rules, depth + 1)
				: classifySegment(nested.argv, rules, depth + 1, null);
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
	const segments = lexShellSegments(command) ?? [];
	for (const [index, segment] of segments.entries()) {
		const verdict = classifySegment(
			segment.tokens,
			rules,
			depth,
			stdinText(segments, index),
		);
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
