/**
 * Derives the full clone target directory from a parent override and the URL,
 * appending the repository name extracted from the URL. Returns the raw parent
 * when no repository name can be parsed so the main process surfaces the
 * validation diagnostic.
 */
export function joinDestination(parent: string, url: string): string {
	const name = extractRepositoryName(url);
	if (!name) {
		return parent;
	}
	return `${stripTrailingSlash(parent)}/${name}`;
}

/** Strips the final `/` from a path so segments can be re-joined. */
function stripTrailingSlash(value: string): string {
	return value.endsWith('/') ? value.replace(/\/+$/, '') : value;
}

const REPO_NAME_PATTERN =
	/(?:[/:])([\w.-]+?)(?:\.git)?(?:\/?$)|^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i;

/** Best-effort extraction of the repository name segment from a GitHub URL. */
export function extractRepositoryName(url: string): string | null {
	const match = url.trim().match(REPO_NAME_PATTERN);
	if (!match) {
		return null;
	}
	const captured = match[1] ?? match[3];
	if (!captured) {
		return null;
	}
	return captured.replace(/\.git$/i, '');
}
