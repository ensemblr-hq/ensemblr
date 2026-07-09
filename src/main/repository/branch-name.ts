/**
 * Pure branch-name composition shared by workspace creation (configured prefix)
 * and auto-rename (prefix carried over from the existing branch). Kept free of
 * the sqlite/pi runtime so both call sites compose names identically and the
 * logic unit-tests under Vitest.
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
