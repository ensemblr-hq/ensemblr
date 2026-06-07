import path from 'node:path';

/**
 * Normalises a user-configured executable path, expanding a leading `~` or
 * `~/` against the supplied home directory before resolving.
 * @param rawPath - Raw path string from settings or environment.
 * @param homeDirectory - Absolute home directory used to expand `~`.
 * @returns Absolute, resolved path.
 */
export function normalizeConfiguredPath(
	rawPath: string,
	homeDirectory: string,
): string {
	if (rawPath === '~') {
		return path.resolve(homeDirectory);
	}

	if (rawPath.startsWith('~/')) {
		return path.resolve(homeDirectory, rawPath.slice(2));
	}

	return path.resolve(rawPath);
}
