/**
 * Lowercased substrings that, when present in a setting/env-var key, mark it
 * as secret-like for redaction and classification. Single source of truth used
 * by config loaders and the environment-variable catalog.
 */
export const SENSITIVE_KEY_PARTS: readonly string[] = [
	'accesstoken',
	'apikey',
	'auth',
	'credential',
	'password',
	'privatekey',
	'secret',
	'token',
];

/**
 * Returns true when a key name contains a known sensitive substring.
 * Comparison is case-insensitive and strips dashes/underscores so both
 * `apiKey` and `api_key` match `apikey`.
 */
export function isSensitiveKeyName(key: string): boolean {
	const normalized = key.replace(/[-_]/g, '').toLowerCase();
	return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}
