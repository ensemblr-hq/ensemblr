import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

/** Inputs for {@link isRepositoryConfigPathAllowed}. */
export interface RepositoryConfigPathAuthorizationOptions {
	database: DatabaseSync | null;
	repositoryPath: string;
}

/**
 * Returns whether the repository path is currently tracked (as either a
 * repository or a workspace), gating repository-config IPC writes.
 *
 * Lives in its own module because authorization is orthogonal to config
 * loading: callers should not need to read parsing logic to be sure a path
 * is permitted.
 * @param options - Open database and candidate path.
 * @returns True when the path matches a tracked entry.
 */
export function isRepositoryConfigPathAllowed({
	database,
	repositoryPath,
}: RepositoryConfigPathAuthorizationOptions): boolean {
	if (!database || !repositoryPath.trim()) {
		return false;
	}

	const resolvedRepositoryPath = path.resolve(repositoryPath);

	try {
		const row = database
			.prepare(
				`
SELECT path FROM repositories WHERE path = ?
UNION
SELECT path FROM workspaces WHERE path = ?
LIMIT 1
`,
			)
			.get(resolvedRepositoryPath, resolvedRepositoryPath);

		return isPathRow(row);
	} catch {
		return false;
	}
}

/**
 * Type guard for the `SELECT path FROM ...` shape returned by
 * {@link isRepositoryConfigPathAllowed}.
 */
function isPathRow(row: unknown): row is { path: string } {
	return (
		typeof row === 'object' &&
		row !== null &&
		'path' in row &&
		typeof row.path === 'string'
	);
}
