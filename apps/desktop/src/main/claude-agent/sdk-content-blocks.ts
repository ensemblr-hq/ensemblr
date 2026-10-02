/**
 * Narrows an unknown value to a plain object.
 * @param value - Candidate value.
 * @returns True when `value` is a non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a message's `content` as an array of block records. String content —
 * the shorthand the SDK accepts for plain user text — is lifted into one text
 * block so both shapes normalize identically.
 *
 * Shared rather than per-reader: a caller that recognizes a message by its block
 * shape has to see the same blocks the normalizer projects, or the two disagree
 * about what a string-content message contains.
 * @param content - Raw `content` field off an SDK message.
 * @returns The blocks, empty when the content is neither a string nor an array.
 */
export function readBlocks(
	content: unknown,
): readonly Record<string, unknown>[] {
	if (typeof content === 'string') {
		return content ? [{ text: content, type: 'text' }] : [];
	}
	return Array.isArray(content) ? content.filter(isRecord) : [];
}
