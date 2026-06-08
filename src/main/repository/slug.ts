/**
 * Normalises a value into a URL-safe slug. Returns `fallback` (default: `''`)
 * when the resulting slug would be empty.
 */
export function toSlug(value: string, fallback = ''): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return slug || fallback;
}
