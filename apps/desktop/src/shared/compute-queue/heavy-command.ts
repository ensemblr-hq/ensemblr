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
 * The peeling lives in `command-normaliser.ts`, the nested commands a command
 * runs — a shell's `-c`, a script fed to a shell, `eval`, `watch`, `find
 * -exec` — in `nested-command.ts`, and the default patterns in
 * `heavy-command-patterns.ts`; this module matches.
 *
 * A line whose top-level quotes do not balance is not classified heavy: it is
 * unreadable as a whole, and bash itself rejects such a line before running any
 * of it. A nested construct that does not close is read as literal text
 * instead, so the commands around it are still classified.
 */
import type { ComputeQueueSettings } from '../config.ts';
import { lexShellSegments } from '../plan-mode.ts';
import { normaliseTokens, type Tokens } from './command-normaliser.ts';
import { DEFAULT_HEAVY_COMMAND_PATTERNS } from './heavy-command-patterns.ts';
import {
	NO_FEED,
	nestedCommands,
	type SegmentFeed,
	segmentFeed,
} from './nested-command.ts';

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

const NOT_HEAVY: HeavyCommandVerdict = { heavy: false };

/** How many levels of nested command — a `bash -c`, an `eval`, a fed script — are followed. */
const MAX_NESTING_DEPTH = 3;

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
 * @param feed - What the command is fed: its stdin, and the scripts its process substitutions print.
 * @returns The verdict for this command.
 */
function classifySegment(
	tokens: Tokens,
	rules: CompiledRules,
	depth: number,
	feed: SegmentFeed,
): HeavyCommandVerdict {
	const forms = candidateForms(normaliseTokens(tokens));
	const exempt = forms.some((form) =>
		rules.exempt.some((pattern) => matchesPattern(pattern, form)),
	);
	if (exempt) {
		return NOT_HEAVY;
	}
	const nested =
		depth < MAX_NESTING_DEPTH ? nestedCommands(forms[0] ?? [], feed) : [];
	for (const command of nested) {
		const inner =
			'text' in command
				? classifyCommandText(command.text, rules, depth + 1)
				: classifySegment(command.argv, rules, depth + 1, NO_FEED);
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
			segmentFeed(segments, index),
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
