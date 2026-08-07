/**
 * Shared line-extraction helper for the naming sanitizers. Kept free of the
 * pi/sqlite runtime so it unit-tests under Vitest alongside its callers.
 */

/**
 * Strips fenced code blocks and returns the first non-empty, trimmed line of a
 * raw model response, or null when none remains. Both the title and branch
 * sanitizers start here before applying their field-specific cleanup.
 * @param text - Raw model output.
 * @returns The first content line, or null.
 */
export function firstContentLine(text: string): string | null {
	const withoutFences = text.replace(/```[a-z]*\s*([\s\S]*?)```/gi, '$1');
	const line = withoutFences
		.split(/\r?\n/)
		.map((candidate) => candidate.trim())
		.find((candidate) => candidate.length > 0);
	return line ?? null;
}
