/**
 * Pure helpers for auto branch-naming. Kept free of the pi/sqlite runtime (only
 * a pure sibling helper is imported) so they unit-test under Vitest.
 */

import { firstContentLine } from './naming/first-content-line.ts';

const BRANCH_NAME_MAX_LENGTH = 40;

/**
 * Normalizes raw LLM output into a git-safe kebab-case slug. Takes the first
 * non-empty line, strips code fences / quotes / `branch:`-style prefixes,
 * lower-cases, collapses every non-alphanumeric run to a single dash, trims
 * dashes, and caps the length at a word boundary. Returns null when nothing
 * usable remains.
 * @param text - The collected agent response.
 * @returns A branch slug, or null.
 */
export function sanitizeBranchSlug(text: string): string | null {
	if (!text) {
		return null;
	}
	const firstLine = firstContentLine(text);
	if (!firstLine) {
		return null;
	}
	const cleaned = firstLine
		.replace(/^(?:branch(?:\s*name)?|name)\s*[:\-—]\s*/i, '')
		.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '');
	const slug = cleaned
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	if (!slug) {
		return null;
	}
	if (slug.length <= BRANCH_NAME_MAX_LENGTH) {
		return slug;
	}
	const window = slug.slice(0, BRANCH_NAME_MAX_LENGTH);
	const lastDash = window.lastIndexOf('-');
	const truncated =
		lastDash > BRANCH_NAME_MAX_LENGTH / 2 ? window.slice(0, lastDash) : window;
	return truncated.replace(/-+$/g, '');
}

/** Workspace metadata fields consulted by the naming gate. */
interface WorkspaceNamingMetadata {
	adoptedBranch?: unknown;
	branchNamed?: unknown;
	placeholderName?: unknown;
	renamedAt?: unknown;
}

/**
 * Reports whether a workspace still carries the auto-generated placeholder name
 * it was created with and has never been renamed. That is the only state naming
 * may overwrite: once the workspace has a chosen name, it is the user's. Pure so
 * the gating contract is unit-tested without the pi/sqlite runtime.
 * @param metadata - The workspace's parsed metadata.
 * @returns True while the workspace has never been named.
 */
export function isWorkspaceNameable(
	metadata: WorkspaceNamingMetadata,
): boolean {
	return (
		metadata.placeholderName === true && typeof metadata.renamedAt !== 'string'
	);
}

/**
 * Reports whether the git branch still carries the generated name it was cut
 * with, which is the state agent branch naming may overwrite.
 *
 * Tracked separately from the display name because the two move independently:
 * a rename that only retitles a workspace leaves its branch on the generated
 * slug, and gating on the display name alone retired the agent's one-shot for a
 * branch nobody had named. A rename stamps `branchNamed` when it moves the
 * branch or is handed one by name; a row predating that flag falls back to the
 * display-name gate, which is what it was judged by when it was written.
 * @param metadata - The workspace's parsed metadata.
 * @returns True while the git branch has never been named.
 */
export function isBranchNameable(metadata: WorkspaceNamingMetadata): boolean {
	if (metadata.adoptedBranch === true) {
		return false;
	}
	if (typeof metadata.branchNamed === 'boolean') {
		return !metadata.branchNamed;
	}
	return isWorkspaceNameable(metadata);
}
