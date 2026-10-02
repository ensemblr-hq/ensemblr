/**
 * The first step both naming derivations share. Kept free of the pi/sqlite
 * runtime so it unit-tests under Vitest alongside its callers.
 */

import { firstContentLine } from './first-content-line.ts';

/** Leading `branch:` / `name -` labels an LLM prefixes its answer with. */
const NAMING_LABEL = /^(?:branch(?:\s*name)?|name)\s*[:\-—]\s*/i;

/** Quote characters wrapping an answer, straight and typographic alike. */
const WRAPPING_QUOTES = /^["'“”‘’`]+|["'“”‘’`]+$/g;

/**
 * Reduces a naming argument to the bare name it carries: the first content
 * line, with the label and quoting an LLM wraps a one-line answer in removed.
 *
 * Both derivations of a naming input start here — `sanitizeBranchSlug` for the
 * git branch and `deriveWorkspaceDisplayName` for the workspace title — so the
 * two render the same text rather than two different readings of one answer.
 * @param raw - The naming argument as it arrived.
 * @returns The bare name, or null when the input carried no content line.
 */
export function readNamingInput(raw: string): string | null {
	const line = firstContentLine(raw);
	if (!line) {
		return null;
	}
	return line.replace(NAMING_LABEL, '').replace(WRAPPING_QUOTES, '').trim();
}
