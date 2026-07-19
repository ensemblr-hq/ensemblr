/**
 * Serializes a metadata record to JSON for storage, falling back to `'{}'` when
 * it is absent or not serializable.
 * @param metadata - Metadata record to serialize.
 * @returns The JSON string, or `'{}'` on missing or invalid input.
 */
export function serializeMetadata(metadata?: Record<string, unknown>): string {
	if (!metadata) {
		return '{}';
	}
	try {
		return JSON.stringify(metadata);
	} catch {
		return '{}';
	}
}

/**
 * Parses a stored metadata JSON string back into a record, returning `{}` for
 * missing, corrupt, or non-object values.
 * @param raw - Stored JSON string.
 * @returns The parsed record, or an empty object on failure.
 */
export function parseMetadata(raw: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// fall through to empty
	}
	return {};
}
