import type { DatabaseSync } from 'node:sqlite';

import type { RepositoryWorkspaceNavigationSnapshot } from '../../shared/ipc';
import { getRepositoryWorkspaceNavigationSnapshot as getSnapshotFromRepository } from '../storage/repositories/repository-workspace-navigation-repository.ts';

/**
 * IPC-layer wrapper around the storage repository. Preserves the positional
 * `database` argument used by `ipc/handlers/core.ts` while delegating SQL and
 * row mapping to `src/main/storage/repositories`.
 * @param database - Open SQLite connection or `null`.
 * @returns A navigation snapshot, empty when no database is available.
 */
export function getRepositoryWorkspaceNavigationSnapshot(
	database: DatabaseSync | null,
): RepositoryWorkspaceNavigationSnapshot {
	return getSnapshotFromRepository({ database });
}
