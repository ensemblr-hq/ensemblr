/** Parses a metadata JSON blob, returning an empty object on any failure. */
export function parseMetadata(
	text: string | undefined,
): Record<string, unknown> {
	if (!text) {
		return {};
	}
	try {
		const parsed = JSON.parse(text);
		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			!Array.isArray(parsed)
		) {
			return parsed as Record<string, unknown>;
		}
		return {};
	} catch {
		return {};
	}
}
