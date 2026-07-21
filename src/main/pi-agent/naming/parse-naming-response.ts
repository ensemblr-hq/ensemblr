/**
 * Pure parser for the branch slug in a naming response. The coordinator asks one
 * ephemeral Pi session for a `BRANCH:` labelled line; this module extracts and
 * sanitizes it, discarding a missing or malformed value (surfaced as null).
 * Kept free of the pi/sqlite runtime so it unit-tests under Vitest.
 */

import { sanitizeBranchSlug } from '../branch-name-slug.ts';

const BRANCH_LABEL = /^\s*branch(?:\s*name)?\s*[:\-—]\s*(.+)$/i;

/**
 * Extracts the branch slug from a raw model response. Scans every line for a
 * `BRANCH:` label (tolerating model preamble and trailing commentary), then runs
 * the captured value through the branch-slug sanitizer.
 * @param raw - The joined agent response text.
 * @returns The sanitized branch slug, or null when absent or unusable.
 */
export function parseBranchSlug(raw: string): string | null {
	const withoutFences = raw.replace(/```[a-z]*\s*([\s\S]*?)```/gi, '$1');
	const lines = withoutFences.split(/\r?\n/);
	for (const line of lines) {
		const match = line.match(BRANCH_LABEL);
		if (match?.[1]) {
			return sanitizeBranchSlug(match[1]);
		}
	}
	return null;
}
