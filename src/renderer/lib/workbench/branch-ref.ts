const ORIGIN_PREFIX_PATTERN = /^(?:refs\/remotes\/)?origin\//;

/** The remote every Ensemblr git operation targets; see the read-only "Remote origin" repo setting. */
const DEFAULT_REMOTE = 'origin';

/**
 * Strips the remote qualifier from a stored base ref, yielding the plain branch
 * name. Base refs reach SQLite in both shapes — bare from a repository's probed
 * default, `origin/<name>` from a picked branch — but `gh pr create --base`,
 * GitHub compare URLs, and prompt templates that add their own `origin/` all
 * need the bare name, and passing the qualified ref to any of them fails.
 * @param ref - A base ref, qualified or bare.
 * @returns The bare branch name, or null when no ref was given.
 */
export function bareBranchName(ref: string | null | undefined): string | null {
	const trimmed = ref?.trim();
	if (!trimmed) {
		return null;
	}
	return trimmed.replace(ORIGIN_PREFIX_PATTERN, '') || null;
}

/**
 * Qualifies a bare branch name with the remote it lives on, matching how base
 * refs are persisted. Already-qualified refs pass through unchanged so callers
 * can normalize values of either shape.
 * @param name - A branch name, qualified or bare.
 * @returns The `origin/`-qualified ref, or null when no name was given.
 */
export function originQualifiedRef(
	name: string | null | undefined,
): string | null {
	const bare = bareBranchName(name);
	return bare ? `${DEFAULT_REMOTE}/${bare}` : null;
}
