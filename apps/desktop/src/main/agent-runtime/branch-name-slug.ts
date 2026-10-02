/**
 * Pure helpers for auto branch-naming. Kept free of the pi/sqlite runtime (only
 * a pure sibling helper is imported) so they unit-test under Vitest.
 */

import { readNamingInput } from './naming/naming-input.ts';

const BRANCH_NAME_MAX_LENGTH = 40;

/**
 * Normalizes raw LLM output into a git-safe kebab-case slug. Reads the bare
 * name through {@link readNamingInput}, lower-cases it, collapses every
 * non-alphanumeric run to a single dash, trims dashes, and caps the length at a
 * word boundary. Returns null when nothing usable remains.
 * @param text - The collected agent response.
 * @returns A branch slug, or null.
 */
export function sanitizeBranchSlug(text: string): string | null {
	if (!text) {
		return null;
	}
	const cleaned = readNamingInput(text);
	if (!cleaned) {
		return null;
	}
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
	branchProvisional?: unknown;
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

/**
 * Reports whether the workspace carries a name the app derived from the user's
 * first prompt rather than one anybody chose.
 *
 * Deliberately not a gate: a provisional workspace is still nameable by both
 * predicates above, because the point of naming it provisionally is to fill the
 * board without spending the agent's one naming call. This only distinguishes
 * "nothing has named this yet" from "the app guessed" — which is what stops the
 * namer running twice, and what picks the wording the upkeep block asks with.
 * @param metadata - The workspace's parsed metadata.
 * @returns True when the current name is the app's provisional guess.
 */
export function isBranchProvisional(
	metadata: WorkspaceNamingMetadata,
): boolean {
	return metadata.branchProvisional === true;
}

/**
 * Reports whether the app may guess this workspace's name from the user's first
 * prompt.
 *
 * Deliberately narrower than the two gates above, which ask whether *somebody*
 * may name the workspace. A guess is only ever an improvement on a generated
 * placeholder, so a workspace anybody has already titled keeps the name it was
 * given even while its branch stays nameable — the app moving a titled
 * workspace's branch onto a slug derived from one prompt is a rename nobody
 * asked for. A workspace the app has already guessed at is left alone too, which
 * is what stops the branch moving again on every prompt of a planning session.
 * @param metadata - The workspace's parsed metadata.
 * @returns True when a provisional rename may run.
 */
export function isProvisionallyNameable(
	metadata: WorkspaceNamingMetadata,
): boolean {
	return (
		isBranchNameable(metadata) &&
		isWorkspaceNameable(metadata) &&
		!isBranchProvisional(metadata)
	);
}
