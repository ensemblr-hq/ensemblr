/**
 * Pure branch-name composition, shared across runtimes. Workspace creation
 * (configured prefix), the rename service (prefix carried over from the existing
 * branch), agent branch naming, and the rename dialog's branch field all compose
 * names through here, so a branch never loses its `prefix/` segment by taking a
 * different route to the same slug.
 */

/**
 * Joins a branch prefix and slug as `<prefix>/<slug>` (e.g. `psoldunov/bach`),
 * collapsing any trailing slash(es) on the prefix so the separator is always a
 * single `/`. An empty prefix yields the bare slug.
 * @param prefix - The resolved prefix (possibly empty).
 * @param slug - The branch slug.
 * @returns The composed branch name.
 */
export function joinBranchName(prefix: string, slug: string): string {
	const normalized = prefix.replace(/\/+$/, '');
	return normalized ? `${normalized}/${slug}` : slug;
}

/**
 * Re-slugs a branch in place, keeping any `prefix/` segment it already carries
 * (e.g. `psoldunov/bach` → `psoldunov/add-dark-mode`). A prefix-less branch (or
 * a leading-slash edge case) becomes the bare slug.
 * @param currentBranch - The workspace's existing branch name.
 * @param slug - The kebab-case slug to land on.
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
