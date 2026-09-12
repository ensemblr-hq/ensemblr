/**
 * Shared GitHub URL parsing and remote URL canonicalisation utilities.
 *
 * Centralises the URL handling that the clone, register, and shared-root
 * adoption flows previously implemented independently. Keeping the patterns
 * and helpers here ensures every entry point agrees on what an accepted
 * GitHub URL looks like and on the canonical key used to detect duplicate
 * remotes in SQLite.
 */

/** Parsed components of an accepted GitHub URL. */
interface ParsedGithubUrl {
	owner: string;
	repositoryName: string;
	sanitizedUrl: string;
	validatedUrl: string;
}

const GITHUB_URL_PATTERN =
	/^https?:\/\/(?:[^/@\s]*@)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;
const SSH_URL_PATTERN = /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i;
const SHORTHAND_URL_PATTERN = /^(?:gh:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i;

/**
 * Rejects the owner and repository names GitHub itself does not issue but the
 * character class admits.
 *
 * A leading `-` reads as a flag bundle to the `gh repo clone` positional, and
 * `.`/`..` resolve the clone destination out of the managed repositories root
 * before anything downstream is asked to catch it — `allocateUniqueTargetPath`
 * is `path.resolve(parent, name)`.
 * @param component - Owner or repository name captured from the URL.
 * @returns True when the name is one GitHub could actually have issued.
 */
function isAcceptableNameComponent(component: string): boolean {
	return (
		component.length > 0 &&
		!component.startsWith('-') &&
		component !== '.' &&
		component !== '..'
	);
}

/**
 * Recognises the GitHub URL forms Ensemblr accepts and returns the canonical
 * `https://github.com/owner/repo.git` form plus the bare `owner/repo` slug
 * passed to `gh repo clone`. Returns `null` for any other input.
 */
export function parseGithubUrl(url: unknown): ParsedGithubUrl | null {
	if (typeof url !== 'string') {
		return null;
	}
	const trimmed = url.trim();
	if (!trimmed) {
		return null;
	}

	const httpsMatch = trimmed.match(GITHUB_URL_PATTERN);
	const sshMatch = !httpsMatch ? trimmed.match(SSH_URL_PATTERN) : null;
	const shortMatch =
		!httpsMatch && !sshMatch ? trimmed.match(SHORTHAND_URL_PATTERN) : null;

	const match = httpsMatch ?? sshMatch ?? shortMatch;
	if (!match) {
		return null;
	}

	const owner = match[1];
	const repoNameRaw = match[2];
	if (!owner || !repoNameRaw) {
		return null;
	}
	const repositoryName = repoNameRaw.replace(/\.git$/i, '');
	if (
		!isAcceptableNameComponent(owner) ||
		!isAcceptableNameComponent(repositoryName)
	) {
		return null;
	}

	return {
		owner,
		repositoryName,
		sanitizedUrl: `https://github.com/${owner}/${repositoryName}.git`,
		validatedUrl: `${owner}/${repositoryName}`,
	};
}

/**
 * Reduces a git remote URL to a canonical `host/owner/repo` key so equivalent
 * `git@github.com:owner/repo`, `ssh://git@github.com/owner/repo.git`, and
 * `https://github.com/owner/repo.git` forms all collide on the same value.
 */
export function normalizeRemoteUrl(value: string | null): string | null {
	if (!value) {
		return null;
	}
	let candidate = value.trim().toLowerCase();
	if (!candidate) {
		return null;
	}
	candidate = candidate.replace(/^(?:https?|ssh|git):\/\//, '');
	candidate = candidate.replace(/^git@/, '');
	candidate = candidate.replace(':', '/');
	candidate = candidate.replace(/\.git$/i, '');
	candidate = candidate.replace(/\/+$/, '');
	return candidate || null;
}
