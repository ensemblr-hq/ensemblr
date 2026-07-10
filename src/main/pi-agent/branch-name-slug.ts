/**
 * Pure helpers for auto branch-naming. Kept free of the pi/sqlite runtime (only
 * a pure sibling helper is imported) so they unit-test under Vitest.
 */

import { joinBranchName } from '../repository/branch-name.ts';

const BRANCH_NAME_MAX_LENGTH = 40;

/**
 * Joins the prefix from the current branch with a new slug, preserving any
 * `prefix/` segment (e.g. `psoldunov/bach` → `psoldunov/add-dark-mode`). A
 * prefix-less branch (or a leading-slash edge case) becomes the bare slug.
 * Delegates the join to {@link joinBranchName} so creation and rename compose
 * names identically.
 * @param currentBranch - The workspace's existing branch name.
 * @param slug - The freshly-generated kebab-case slug.
 * @returns The renamed branch.
 */
export function composeRenamedBranch(
	currentBranch: string,
	slug: string,
): string {
	const lastSlash = currentBranch.lastIndexOf('/');
	const prefix = lastSlash > 0 ? currentBranch.slice(0, lastSlash) : '';
	return joinBranchName(prefix, slug);
}

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
	const stripped = text.replace(/```[a-z]*\s*([\s\S]*?)```/gi, '$1');
	const firstLine = stripped
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0);
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

/** Workspace metadata fields consulted by the auto-rename gate. */
export interface AutoRenameMetadata {
	placeholderName?: unknown;
	renamedAt?: unknown;
}

/** Inputs to {@link shouldAutoRenameWorkspace}. */
export interface AutoRenameGate {
	/** The first-turn prompt (pre-trim); empty/whitespace blocks the rename. */
	prompt: string | undefined;
	/** The `git.renameWorkspaceOnBranch` user setting. */
	renameEnabled: boolean;
	/** The workspace's parsed metadata. */
	metadata: AutoRenameMetadata;
}

/**
 * Decides whether a fresh session's first turn should trigger an auto branch
 * rename. Renames only when all hold: a non-empty prompt exists, the user
 * setting is on, the workspace still carries its auto-generated placeholder
 * name, and it was not already auto-renamed (`renamedAt` stamped). Pure so the
 * full gating contract is unit-tested without the pi/sqlite runtime.
 * @param gate - Prompt, setting, and metadata.
 * @returns True when the rename should proceed.
 */
export function shouldAutoRenameWorkspace({
	metadata,
	prompt,
	renameEnabled,
}: AutoRenameGate): boolean {
	if (!prompt?.trim()) {
		return false;
	}
	if (!renameEnabled) {
		return false;
	}
	if (metadata.placeholderName !== true) {
		return false;
	}
	if (typeof metadata.renamedAt === 'string') {
		return false;
	}
	return true;
}
