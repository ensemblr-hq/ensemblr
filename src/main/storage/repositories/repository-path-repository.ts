import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

/** Inputs for {@link isTrackedRepositoryPath}. */
export interface IsTrackedRepositoryPathOptions {
	database: DatabaseSync | null;
	repositoryPath: string;
}

/**
 * Returns whether the on-disk path matches a currently-tracked repository or
 * workspace row. Used to gate repository-config IPC writes — the renderer can
 * only mutate config for paths Ensemblr already knows about.
 */
export function isTrackedRepositoryPath({
	database,
	repositoryPath,
}: IsTrackedRepositoryPathOptions): boolean {
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
 * Type guard narrowing an unknown SQLite row to one exposing a string `path`.
 * @param row - Value returned from a SQLite query
 * @returns True when the row has a string `path`
 */
function isPathRow(row: unknown): row is { path: string } {
	return (
		typeof row === 'object' &&
		row !== null &&
		'path' in row &&
		typeof row.path === 'string'
	);
}
