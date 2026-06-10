import type { DatabaseSync } from 'node:sqlite';

/**
 * Returns the on-disk path for a workspace row, or `null` when the row does
 * not exist. Used by IPC handlers that need to resolve the workspace cwd
 * without pulling in the full navigation snapshot.
 */
export function getWorkspacePathById({
	database,
	workspaceId,
}: {
	database: DatabaseSync;
	workspaceId: string;
}): string | null {
	const row = database
		.prepare(`SELECT path FROM workspaces WHERE id = ?`)
		.get(workspaceId) as { path: string } | undefined;
	return row?.path ?? null;
}
