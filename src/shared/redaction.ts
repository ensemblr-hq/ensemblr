import { SENSITIVE_KEY_PARTS } from './sensitive-key.ts';

/** Placeholder every redactor substitutes for a secret. */
export const REDACTED = '[REDACTED]';

/**
 * Key substrings that mark a name as secret-like *for redaction only*.
 *
 * Deliberately wider than {@link SENSITIVE_KEY_PARTS}, which also decides
 * whether a declarative `settings.toml` entry is refused and whether the
 * environment panel renders `[set]`. Over-redacting a log costs a diagnostic;
 * over-classifying a config key refuses a variable the user meant to set, so
 * the two lists are not one.
 */
export const REDACTION_KEY_PARTS: readonly string[] = [
	...SENSITIVE_KEY_PARTS,
	'bearer',
	'cookie',
	'dsn',
	'pass',
	'session',
	'signing',
];

/**
 * Key segments that make a name secret-like on their own but are too short or
 * too common to match as substrings: `KEY` catches `OPENAI_KEY` without
 * catching `KEYBOARD_LAYOUT`.
 */
const REDACTION_KEY_SEGMENTS: readonly string[] = [
	'jwt',
	'key',
	'keys',
	'pat',
	'pw',
	'sig',
];

/**
 * One named secret shape the value pass recognises anywhere in a text, whatever
 * key it sits behind.
 *
 * This array is the corpus: `tests/shared/redaction.test.ts` drives every entry
 * from the same table, so a new provider prefix added here without a matching
 * sample — or added to one redactor and not the others — fails a test rather
 * than silently covering only the sink whose author remembered it.
 */
export interface SecretValuePattern {
	/** Stable id, used by the test corpus to pair a pattern with its samples. */
	id: string;
	/** Global-flagged matcher for the secret's literal shape. */
	pattern: RegExp;
	/** What the match is replaced with; defaults to {@link REDACTED}. */
	replacement?: string;
}

/**
 * Every secret shape recognised by value rather than by the key in front of it.
 *
 * Sourced from the three redactors this module replaced plus the provider
 * prefixes the audit found passing through all of them. Order matters only in
 * that the broadest matcher (`hex-token`) runs last, so a more specific shape
 * claims its own text first.
 */
export const SECRET_VALUE_PATTERNS: readonly SecretValuePattern[] = [
	{
		id: 'pem-private-key',
		pattern:
			/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g,
	},
	{
		id: 'github-token',
		pattern:
			/\b(?:gh[opsru]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/g,
	},
	{ id: 'openai-style-key', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
	{ id: 'slack-token', pattern: /\bxox[abeoprs]-[A-Za-z0-9-]{10,}\b/g },
	{ id: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
	{ id: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
	{
		id: 'jwt',
		pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
	},
	{
		id: 'url-userinfo',
		pattern: /([a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:)[^\s/@]+(@)/gi,
		replacement: `$1${REDACTED}$2`,
	},
	{ id: 'hex-token', pattern: /\b[a-f0-9]{32,}\b/gi },
];

/**
 * Home directories collapsed to `~` so a support bundle carries no username.
 * macOS and Linux both, because Linux is a shipped target rather than a port.
 */
const HOME_PATH_PATTERNS: readonly RegExp[] = [
	/\/Users\/[^/\s'"]+/g,
	/\/home\/[^/\s'"]+/g,
	/\/root\b/g,
];

/**
 * Key-name fragments the assignment scanner recognises inside a larger name, so
 * `MY_APP_API_KEY=…` redacts as readily as `API_KEY=…`.
 *
 * Spelled out rather than derived from {@link REDACTION_KEY_PARTS}, because a
 * part is the separator-stripped form (`accesstoken`) and free text carries the
 * separators (`ACCESS_TOKEN`). The corpus test holds the two in step: every
 * part must be matched by one of these, so widening the parts list without
 * widening this one is a failing test rather than a silent gap.
 *
 * A literal alternation is also what keeps the scan cheap on an 8 MB stdout —
 * the engine can skip any window containing none of these words, where an
 * open-ended `[A-Za-z0-9_]*[=:]` has to backtrack at every offset.
 */
export const ASSIGNMENT_KEY_SOURCES: readonly string[] = [
	'ACCESS[_-]?TOKEN',
	'API[_-]?KEYS?',
	'AUTH(?:ORIZATION)?',
	'BEARER',
	'COOKIES?',
	'CREDENTIALS?',
	'DSN',
	'JWT',
	'PASS(?:WORD|WD|PHRASE)?',
	'PRIVATE[_-]?KEY',
	'SECRETS?',
	'SESSION',
	'SIGNING(?:[_-]?KEY)?',
	'TOKEN',
	'[A-Z0-9]+[_-]KEY',
];

/**
 * Matches `SOME_TOKEN=value` and `apiKey: value` assignments in free text,
 * capturing the key, the separator, an opening quote, and the value.
 * @returns A fresh global-flagged matcher, so no `lastIndex` is shared.
 */
function assignmentPattern(): RegExp {
	return new RegExp(
		`\\b([A-Z0-9_.-]*(?:${ASSIGNMENT_KEY_SOURCES.join('|')})[A-Z0-9_.-]*)(\\s*[=:]\\s*)(["']?)([^\\s"',;]+)`,
		'gi',
	);
}

/**
 * Shortest value worth redacting. Below it a match is as likely to be a flag or
 * a placeholder as a credential, and blanking it only costs readability.
 */
const MINIMUM_VALUE_LENGTH = 4;

/**
 * Normalises a key name for substring comparison, dropping every separator so
 * `api_key`, `api-key` and `apiKey` all reduce to `apikey`.
 * @param key - Raw key name.
 * @returns The normalised name.
 */
function normalizeKeyName(key: string): string {
	return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Splits a key name into the segments a reader would see as words, across
 * separator and camelCase boundaries.
 * @param key - Raw key name.
 * @returns The lowercased segments.
 */
function keySegments(key: string): string[] {
	return key
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean)
		.map((segment) => segment.toLowerCase());
}

/**
 * Reports whether a key name should have its value redacted from logs and
 * diagnostics. Wider than `isSensitiveKeyName`, which also gates classification.
 * @param key - Key name to test.
 * @returns True when the value behind this key must not be surfaced.
 */
export function isRedactableKeyName(key: string): boolean {
	const normalized = normalizeKeyName(key);

	return (
		REDACTION_KEY_PARTS.some((part) => normalized.includes(part)) ||
		keySegments(key).some((segment) => REDACTION_KEY_SEGMENTS.includes(segment))
	);
}

/**
 * Replaces every recognised secret shape in a text, independent of any key or
 * environment.
 * @param text - Text to scan.
 * @returns The text with known secret shapes replaced.
 */
export function redactSecretShapes(text: string): string {
	let redacted = text;

	for (const { pattern, replacement } of SECRET_VALUE_PATTERNS) {
		redacted = redacted.replace(pattern, replacement ?? REDACTED);
	}

	return redacted;
}

/**
 * Replaces the value of every secret-named assignment in a text, keeping the
 * key and separator so a later grep still finds the line.
 * @param text - Text to scan.
 * @returns The text with secret-named assignment values replaced.
 */
export function redactSecretAssignments(text: string): string {
	return text.replace(
		assignmentPattern(),
		(_match, key: string, separator: string, quote: string) =>
			`${key}${separator}${quote}${REDACTED}`,
	);
}

/**
 * Collapses macOS and Linux home directories to `~` so a copied diagnostics
 * bundle carries no username.
 * @param text - Text to scan.
 * @returns The text with home directories collapsed.
 */
export function maskHomeDirectories(text: string): string {
	return HOME_PATH_PATTERNS.reduce(
		(masked, pattern) => masked.replace(pattern, '~'),
		text,
	);
}

/**
 * Runs the whole corpus over a text: every known secret shape, then every
 * secret-named assignment. The pass every sink shares when it has no literal
 * secret values of its own to add.
 * @param text - Text to scan.
 * @returns The redacted text.
 */
export function redactSecrets(text: string): string {
	return redactSecretAssignments(redactSecretShapes(text));
}

/** Replaces every secret-shaped substring, then every secret-named assignment. */
export type TextRedactor = (text: string) => string;

/**
 * Builds the redactor every sink shares: known literal values first, then the
 * value-shape corpus, then secret-named assignments.
 *
 * Literal values come first so a credential that also matches a shape is
 * replaced once rather than partially rewritten by the narrower pattern.
 * @param values - Literal secret values to replace verbatim, in any order.
 * @returns A redactor over free text.
 */
export function createTextRedactor(
	values: Iterable<string> = [],
): TextRedactor {
	const literals = Array.from(
		new Set(
			Array.from(values).filter(
				(value) => value.length >= MINIMUM_VALUE_LENGTH,
			),
		),
	).sort((left, right) => right.length - left.length);

	return (text) => {
		const withoutLiterals = literals.reduce(
			(redacted, literal) => redacted.split(literal).join(REDACTED),
			text,
		);

		return redactSecretAssignments(redactSecretShapes(withoutLiterals));
	};
}

/**
 * Collects the values worth redacting verbatim from an environment map: every
 * entry whose key reads as secret-like, plus any value the caller already knows
 * is one.
 *
 * The audit's case is the second half: an environment carrying `OPENAI_KEY`
 * used to contribute nothing, so the key *and* its value survived into the log.
 * @param env - Environment to scan.
 * @param explicitValues - Values the caller resolved from a secret store.
 * @returns The literal values a redactor should replace.
 */
export function collectRedactableValues(
	env: Record<string, string>,
	explicitValues: readonly string[] = [],
): string[] {
	const values = new Set<string>(explicitValues);

	for (const [key, value] of Object.entries(env)) {
		if (isRedactableKeyName(key)) {
			values.add(value);
		}
	}

	return Array.from(values).filter(
		(value) => value.length >= MINIMUM_VALUE_LENGTH,
	);
}
