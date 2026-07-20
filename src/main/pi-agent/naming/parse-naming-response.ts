/**
 * Pure parser for the structured naming response. The coordinator asks one
 * ephemeral Pi session for a `TITLE:` and/or `BRANCH:` labelled block; this
 * module extracts and sanitizes each requested field independently so a missing
 * or malformed field is discarded (surfaced as null) without poisoning the
 * other. Kept free of the pi/sqlite runtime so it unit-tests under Vitest.
 */

import { sanitizeBranchSlug } from '../branch-name-slug.ts';
import { sanitizeChatTitle } from './sanitize-title.ts';

/** Which fields the caller asked the model to produce this round. */
export interface NamingRequest {
	wantBranch: boolean;
	wantTitle: boolean;
}

/** Sanitized naming fields; a field is null when not requested, absent, or unusable. */
export interface NamingFields {
	branchSlug: string | null;
	title: string | null;
}

const TITLE_LABEL = /^\s*title\s*[:\-—]\s*(.+)$/i;
const BRANCH_LABEL = /^\s*branch(?:\s*name)?\s*[:\-—]\s*(.+)$/i;

/**
 * Extracts the requested naming fields from a raw model response. Scans every
 * line for a `TITLE:`/`BRANCH:` label (tolerating model preamble and trailing
 * commentary), then runs each captured value through its dedicated sanitizer.
 * @param raw - The joined agent response text.
 * @param request - Which fields to extract.
 * @returns The sanitized fields; unrequested or unusable fields are null.
 */
export function parseNamingResponse(
	raw: string,
	request: NamingRequest,
): NamingFields {
	const withoutFences = raw.replace(/```[a-z]*\s*([\s\S]*?)```/gi, '$1');
	const lines = withoutFences.split(/\r?\n/);

	return {
		branchSlug: request.wantBranch
			? findAndSanitize(lines, BRANCH_LABEL, sanitizeBranchSlug)
			: null,
		title: request.wantTitle
			? findAndSanitize(lines, TITLE_LABEL, sanitizeChatTitle)
			: null,
	};
}

/**
 * Finds the first line matching `label`, then sanitizes its captured value.
 * Returns null when no labelled line exists or the value sanitizes away.
 * @param lines - Response lines to scan.
 * @param label - Label regex capturing the value in group 1.
 * @param sanitize - Field-specific sanitizer applied to the captured value.
 * @returns The sanitized value, or null.
 */
function findAndSanitize(
	lines: readonly string[],
	label: RegExp,
	sanitize: (value: string) => string | null,
): string | null {
	for (const line of lines) {
		const match = line.match(label);
		if (match?.[1]) {
			return sanitize(match[1]);
		}
	}
	return null;
}
