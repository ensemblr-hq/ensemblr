import {
	collectRedactableValues,
	createTextRedactor,
	isRedactableKeyName,
	REDACTED,
	type TextRedactor,
} from '../../shared/redaction.ts';
import type { LocalCommandSanitizedLogs } from './command-types.ts';

/** Everything {@link createSanitizedLogs} needs to redact one command's record. */
export interface SanitizedLogsInput {
	args: readonly string[];
	command: string;
	cwd: string;
	env: Record<string, string>;
	redactValues?: readonly string[];
	stderr: string;
	stdout: string;
}

/**
 * Builds the sanitized log payload by redacting secrets in every textual field.
 *
 * Redaction runs on three grounds, all from `src/shared/redaction.ts` so the
 * setup-diagnostics and support-bundle sinks apply the same corpus: the literal
 * values this command's environment carries, the provider-shaped secrets any
 * output may contain, and secret-named assignments in free text.
 * @param input - Raw command, args, env and output streams.
 * @returns A {@link LocalCommandSanitizedLogs} payload safe to persist.
 */
export function createSanitizedLogs({
	args,
	command,
	cwd,
	env,
	redactValues = [],
	stderr,
	stdout,
}: SanitizedLogsInput): LocalCommandSanitizedLogs {
	const redact = createTextRedactor(collectRedactableValues(env, redactValues));

	return {
		command: formatCommandLabel(command, args, redact),
		cwd: redact(cwd),
		env: sanitizeEnvironment(env, redact),
		stderr: redact(stderr),
		stdout: redact(stdout),
	};
}

/**
 * Wraps {@link createSanitizedLogs} in a payload that redacts on first property
 * read and memoizes the result.
 *
 * Sanitizing is linear in the output size — 41 ms on an 8 MB stdout — and every
 * command result used to pay it on settle, while only the setup checks and the
 * Pi readiness probe ever read the payload. Every `git status`, `git diff`, and
 * `du` in the app discarded it unread.
 * @param input - Raw command, args, env and output streams.
 * @returns A {@link LocalCommandSanitizedLogs} whose fields sanitize on demand.
 */
export function createLazySanitizedLogs(
	input: SanitizedLogsInput,
): LocalCommandSanitizedLogs {
	let sanitized: LocalCommandSanitizedLogs | null = null;

	/**
	 * Sanitizes once and reuses the result for every later field read.
	 * @returns The fully sanitized payload.
	 */
	function resolve(): LocalCommandSanitizedLogs {
		sanitized ??= createSanitizedLogs(input);

		return sanitized;
	}

	return {
		get command() {
			return resolve().command;
		},
		get cwd() {
			return resolve().cwd;
		},
		get env() {
			return resolve().env;
		},
		get stderr() {
			return resolve().stderr;
		},
		get stdout() {
			return resolve().stdout;
		},
	};
}

/**
 * Returns a sorted clone of `env` where sensitive keys are wholly redacted and
 * other values pass through the redactor.
 * @param env - Environment to sanitize.
 * @param redact - Redactor used for non-sensitive values.
 * @returns The sanitized environment map.
 */
function sanitizeEnvironment(
	env: Record<string, string>,
	redact: TextRedactor,
): Record<string, string> {
	const sanitized: Record<string, string> = {};

	for (const key of Object.keys(env).sort()) {
		sanitized[key] = isRedactableKeyName(key) ? REDACTED : redact(env[key]);
	}

	return sanitized;
}

/**
 * Renders the command line as a shell-safe, redacted single-line string.
 * @param command - Command executable.
 * @param args - Positional arguments.
 * @param redact - Redactor applied to each rendered part.
 * @returns The sanitized command line.
 */
function formatCommandLabel(
	command: string,
	args: readonly string[],
	redact: TextRedactor,
): string {
	return [command, ...sanitizeArgs(args, redact)]
		.map((part) => quoteCommandPart(redact(part)))
		.join(' ');
}

/**
 * Redacts argument values that follow a known secret-shaped flag and any inline
 * `--secret=value` arguments.
 * @param args - Positional arguments.
 * @param redact - Redactor for arguments that don't match the secret patterns.
 * @returns A new array of sanitized arguments.
 */
function sanitizeArgs(args: readonly string[], redact: TextRedactor): string[] {
	const sanitized: string[] = [];
	let redactNext = false;

	for (const arg of args) {
		if (redactNext) {
			sanitized.push(REDACTED);
			redactNext = false;
			continue;
		}

		if (isSensitiveFlag(arg)) {
			sanitized.push(arg);
			redactNext = true;
			continue;
		}

		sanitized.push(redactSensitiveInlineArg(arg, redact));
	}

	return sanitized;
}

/**
 * Tests whether an argument looks like a `--secret`-style flag whose value
 * should be redacted in the following position.
 * @param arg - Argument to test.
 * @returns True for flag-shaped, secret-named arguments.
 */
function isSensitiveFlag(arg: string): boolean {
	if (!arg.startsWith('-') || arg.includes('=')) {
		return false;
	}

	return isRedactableKeyName(arg.replace(/^-+/, ''));
}

/**
 * Redacts a single inline `key=value` argument when the key matches a known
 * sensitive name; otherwise defers to the generic redactor.
 * @param arg - Argument to consider.
 * @param redact - Fallback redactor.
 * @returns The (possibly) redacted argument.
 */
function redactSensitiveInlineArg(arg: string, redact: TextRedactor): string {
	const separatorIndex = arg.indexOf('=');

	if (separatorIndex > 0 && isRedactableKeyName(arg.slice(0, separatorIndex))) {
		return `${arg.slice(0, separatorIndex + 1)}${REDACTED}`;
	}

	return redact(arg);
}

/**
 * Quotes a command-line token for safe shell rendering, escaping single quotes.
 * @param part - Token to quote.
 * @returns A shell-safe representation of `part`.
 */
function quoteCommandPart(part: string): string {
	if (part === '') {
		return "''";
	}

	if (/^[A-Za-z0-9_./:=@%+-]+$/.test(part)) {
		return part;
	}

	return `'${part.replace(/'/g, "'\\''")}'`;
}
