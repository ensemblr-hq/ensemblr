import type { DatabaseSync } from 'node:sqlite';

/** A live workspace whose shared settings may be read or written. */
export interface WorkspaceSettingsTarget {
	repositoryId: string;
	repositoryPath: string;
	workspaceId: string;
	workspacePath: string;
}

/**
 * Resolves a renderer-selected settings target through the repository/workspace
 * relationship stored by Ensemblr. Root clones are never returned.
 * @param database - Active database connection.
 * @param repositoryId - Repository the settings screen belongs to.
 * @param workspaceId - Live workspace selected as the publication target.
 * @returns The validated target, or null for unknown, archived, or mismatched ids.
 */
export function resolveWorkspaceSettingsTarget({
	database,
	repositoryId,
	workspaceId,
}: {
	database: DatabaseSync;
	repositoryId: string;
	workspaceId: string;
}): WorkspaceSettingsTarget | null {
	const row = database
		.prepare(
			`SELECT
				w.id AS workspaceId,
				w.path AS workspacePath,
				w.repository_id AS repositoryId,
				r.path AS repositoryPath
			 FROM workspaces w
			 INNER JOIN repositories r ON r.id = w.repository_id
			 WHERE w.id = ?
				AND w.repository_id = ?
				AND w.archived_at IS NULL
				AND r.archived_at IS NULL`,
		)
		.get(workspaceId, repositoryId);

	if (typeof row !== 'object' || row === null) {
		return null;
	}

	const candidate = row as Record<string, unknown>;

	return typeof candidate.workspaceId === 'string' &&
		typeof candidate.workspacePath === 'string' &&
		typeof candidate.repositoryId === 'string' &&
		typeof candidate.repositoryPath === 'string'
		? {
				repositoryId: candidate.repositoryId,
				repositoryPath: candidate.repositoryPath,
				workspaceId: candidate.workspaceId,
				workspacePath: candidate.workspacePath,
			}
		: null;
}
