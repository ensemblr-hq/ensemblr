import type { DatabaseSync } from 'node:sqlite';

import { deleteWorkspaceRowById } from '../storage/repositories/workspace-repository.ts';
import { withTransaction } from '../storage/tx.ts';

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
	withTransaction(database, () => {
		deleteWorkspaceRowById({ database, id });
	});
}
