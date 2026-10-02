/**
 * Shared line-extraction helper for the naming sanitizers. Kept free of the
 * pi/sqlite runtime so it unit-tests under Vitest alongside its callers.
 */

import { decodeHtmlEntities } from './decode-html-entities.ts';

/**
 * Strips fenced code blocks, decodes HTML entities, and returns the first
 * non-empty, trimmed line of a raw model response, or null when none remains.
 * Both the title and branch sanitizers start here before applying their
 * field-specific cleanup, which is why the decode belongs here rather than in
 * one of them: an encoded `&amp;` is source-format noise of the same kind as a
 * stray asterisk, and it would otherwise reach a branch slug as the word `amp`.
 *
 * The decode runs over the whole response before the split rather than per line,
 * so an entity that resolves to a line break is split on like the character it
 * names instead of surviving inside the "first" line.
 * @param text - Raw model output.
 * @returns The first content line, or null.
 */
export function firstContentLine(text: string): string | null {
	const withoutFences = text.replace(/```[a-z]*\s*([\s\S]*?)```/gi, '$1');
	const line = decodeHtmlEntities(withoutFences)
		.split(/\r?\n/)
		.map((candidate) => candidate.trim())
		.find((candidate) => candidate.length > 0);
	return line ?? null;
}
