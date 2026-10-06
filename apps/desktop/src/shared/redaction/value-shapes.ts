/**
 * Value shapes that tell a credential from plain configuration.
 *
 * Exact-value redaction over a transcript replaces a value wherever it appears,
 * in source files and prose alike. An environment layer that carries every
 * variable of a project — `NODE_ENV=production`, `PORT=3000`,
 * `AWS_REGION=us-east-1` — would otherwise have those words rewritten into
 * placeholders in every file the model reads, and the model would write the
 * placeholders back into code. These shapes are what such configuration looks
 * like; a credential rarely does.
 */

/** Shortest value worth redacting from a transcript at all. */
export const MINIMUM_TRANSCRIPT_SECRET_LENGTH = 6;

/** Shortest value worth redacting when nothing but its shape vouches for it. */
const MINIMUM_UNKEYED_SECRET_LENGTH = 8;

/** Longest single alphabetic word still read as a configuration value. */
const MAXIMUM_PLAIN_WORD_LENGTH = 16;

/** Longest dotted or dashed identifier still read as a configuration value. */
const MAXIMUM_PLAIN_IDENTIFIER_LENGTH = 24;

/** Longest URL without credentials still read as a configuration value. */
const MAXIMUM_PLAIN_URL_LENGTH = 40;

/** Only digits and punctuation: a port, a version, a number, a date. */
const DIGITS_AND_PUNCTUATION = /^[\d.:,_-]+$/;

/** One alphabetic word, such as `production` or `debug`. */
const ALPHABETIC_WORD = /^[A-Za-z]+$/;

/** A dotted or dashed identifier, such as `us-east-1` or `db.example.com`. */
const DOTTED_IDENTIFIER = /^[A-Za-z]+(?:[-_.][A-Za-z0-9]+)+$/;

/** Any URL, by its scheme. */
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** A URL with a userinfo part — an `@` before the first `/` after `://`. */
const CREDENTIAL_URL = /^[a-z][a-z0-9+.-]*:\/\/[^/\s]+@/i;

/** An absolute, home-relative, or relative filesystem path with no whitespace. */
const FILESYSTEM_PATH = /^(?:\/|~\/|\.\.?\/)\S*$/;

/**
 * Whether a value is only digits and punctuation, which no secret-named key
 * makes distinctive: a port or a version recurs all over unrelated text.
 * @param value - Candidate value.
 * @returns True for values such as `3000`, `1.2.3`, or `2024-01-01`.
 */
export function isDigitsAndPunctuation(value: string): boolean {
	return DIGITS_AND_PUNCTUATION.test(value);
}

/**
 * Whether a value is a URL that carries credentials in its userinfo part.
 * @param value - Candidate value.
 * @returns True for `scheme://user:pass@host` and `scheme://token@host`.
 */
export function isCredentialUrl(value: string): boolean {
	return CREDENTIAL_URL.test(value);
}

/**
 * Whether a value nothing else vouches for looks like plain configuration
 * rather than a credential.
 * @param value - Candidate value, already known to be long enough to consider.
 * @returns True when the value should be left in the transcript.
 */
export function looksLikePlainConfig(value: string): boolean {
	return (
		value.length < MINIMUM_UNKEYED_SECRET_LENGTH ||
		isDigitsAndPunctuation(value) ||
		(ALPHABETIC_WORD.test(value) && value.length < MAXIMUM_PLAIN_WORD_LENGTH) ||
		(DOTTED_IDENTIFIER.test(value) &&
			value.length < MAXIMUM_PLAIN_IDENTIFIER_LENGTH) ||
		(URL_SCHEME.test(value) &&
			!value.includes('@') &&
			value.length < MAXIMUM_PLAIN_URL_LENGTH) ||
		FILESYSTEM_PATH.test(value)
	);
}
