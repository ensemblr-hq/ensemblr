import type { DatabaseSync } from 'node:sqlite';

/**
 * Removes a workspace row in a single transaction. Shared by the archive
 * flow (intentional removal) and the shared-root reconciler (vanished-row
 * cleanup) — both want atomic delete + rollback semantics.
 */
export function deleteWorkspaceRow({
	database,
	id,
}: {
	database: DatabaseSync;
	id: string;
}): void {
	database.exec('BEGIN');
	try {
		database.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
}
