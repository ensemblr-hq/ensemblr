import type { LocalCommandSanitizedLogs } from './command-types.ts';

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_PARTS = [
	'accesstoken',
	'apikey',
	'auth',
	'credential',
	'password',
	'privatekey',
	'secret',
	'token',
];
const SENSITIVE_ASSIGNMENT_PATTERN =
	/\b([A-Z0-9_.-]*(?:ACCESS[_-]?TOKEN|API[_-]?KEY|CREDENTIAL|PASSWORD|PRIVATE[_-]?KEY|SECRET|TOKEN)[A-Z0-9_.-]*)(\s*[=:]\s*)(["']?)([^\s"',;]+)/gi;

/**
 * Builds the sanitized log payload by redacting secrets in every textual field.
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
}: {
	args: readonly string[];
	command: string;
	cwd: string;
	env: Record<string, string>;
	redactValues?: readonly string[];
	stderr: string;
	stdout: string;
}): LocalCommandSanitizedLogs {
	const redactor = createRedactor(env, redactValues);

	return {
		command: formatCommandLabel(command, args, redactor),
		cwd: redactor.redact(cwd),
		env: sanitizeEnvironment(env, redactor),
		stderr: redactor.redact(stderr),
		stdout: redactor.redact(stdout),
	};
}

/**
 * Builds a redactor that replaces sensitive environment values and inline
 * secret-shaped assignments with a placeholder.
 * @param env - Environment to scan for sensitive entries.
 * @param explicitValues - Caller-supplied secret values to redact.
 * @returns A `{ redact }` helper.
 */
function createRedactor(
	env: Record<string, string>,
	explicitValues: readonly string[],
): { redact: (value: string) => string } {
	const sensitiveValues = new Set<string>();

	for (const [key, value] of Object.entries(env)) {
		if (isSensitiveKey(key) && value.length >= 4) {
			sensitiveValues.add(value);
		}
	}

	for (const value of explicitValues) {
		if (value.length >= 4) {
			sensitiveValues.add(value);
		}
	}

	const values = Array.from(sensitiveValues).sort(
		(left, right) => right.length - left.length,
	);

	return {
		/**
		 * Returns the input with all known secret values and inline secret
		 * assignments replaced by the redaction placeholder.
		 * @param value - Text to redact.
		 * @returns Redacted text.
		 */
		redact(value) {
			let redacted = value;

			for (const sensitiveValue of values) {
				redacted = redacted.split(sensitiveValue).join(REDACTED);
			}

			return redacted.replace(
				SENSITIVE_ASSIGNMENT_PATTERN,
				(_match, key: string, separator: string, quote: string) =>
					`${key}${separator}${quote}${REDACTED}`,
			);
		},
	};
}

/**
 * Returns a sorted clone of `env` where sensitive keys are wholly redacted and
 * other values pass through the redactor.
 * @param env - Environment to sanitize.
 * @param redactor - Redactor used for non-sensitive values.
 * @returns The sanitized environment map.
 */
function sanitizeEnvironment(
	env: Record<string, string>,
	redactor: { redact: (value: string) => string },
): Record<string, string> {
	const sanitized: Record<string, string> = {};

	for (const key of Object.keys(env).sort()) {
		sanitized[key] = isSensitiveKey(key) ? REDACTED : redactor.redact(env[key]);
	}

	return sanitized;
}

/**
 * Renders the command line as a shell-safe, redacted single-line string.
 * @param command - Command executable.
 * @param args - Positional arguments.
 * @param redactor - Redactor applied to each rendered part.
 * @returns The sanitized command line.
 */
function formatCommandLabel(
	command: string,
	args: readonly string[],
	redactor: { redact: (value: string) => string },
): string {
	return [command, ...sanitizeArgs(args, redactor)]
		.map((part) => quoteCommandPart(redactor.redact(part)))
		.join(' ');
}

/**
 * Redacts argument values that follow a known secret-shaped flag and any inline
 * `--secret=value` arguments.
 * @param args - Positional arguments.
 * @param redactor - Redactor for arguments that don't match the secret patterns.
 * @returns A new array of sanitized arguments.
 */
function sanitizeArgs(
	args: readonly string[],
	redactor: { redact: (value: string) => string },
): string[] {
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

		sanitized.push(redactSensitiveInlineArg(arg, redactor));
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

	return isSensitiveKey(arg.replace(/^-+/, ''));
}

/**
 * Redacts a single inline `key=value` argument when the key matches a known
 * sensitive name; otherwise defers to the generic redactor.
 * @param arg - Argument to consider.
 * @param redactor - Fallback redactor.
 * @returns The (possibly) redacted argument.
 */
function redactSensitiveInlineArg(
	arg: string,
	redactor: { redact: (value: string) => string },
): string {
	const separatorIndex = arg.indexOf('=');

	if (separatorIndex > 0 && isSensitiveKey(arg.slice(0, separatorIndex))) {
		return `${arg.slice(0, separatorIndex + 1)}${REDACTED}`;
	}

	return redactor.redact(arg);
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

/**
 * Tests whether a key name looks sensitive (e.g. contains "token" or "secret").
 * @param key - Key to test.
 * @returns True when the normalised key contains a sensitive substring.
 */
function isSensitiveKey(key: string): boolean {
	const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');

	return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}
