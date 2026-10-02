/**
 * Normalises a value into a URL-safe slug: lowercased, with every run of
 * non-alphanumerics collapsed to a single dash and leading/trailing dashes
 * stripped. Returns `fallback` (default: `''`) when the slug would be empty.
 * Single source of truth for the workspace/branch/repository slug shape, shared
 * across the main process, the renderer branch preview, and the composer-name
 * picker so all three stay byte-for-byte in agreement.
 * @param value - Raw name to slugify.
 * @param fallback - Value returned when the slug is empty.
 * @returns The slug, or `fallback` when empty.
 */
export function toSlug(value: string, fallback = ''): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return slug || fallback;
}
