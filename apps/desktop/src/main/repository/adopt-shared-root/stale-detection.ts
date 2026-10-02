import { statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import type {
	SharedRootAdoptionStaleRepositoryRecord,
	SharedRootAdoptionStaleWorkspaceRecord,
} from '../../../shared/ipc/contracts/shared-root-adoption';
import { listRepositoryRowsByPathPrefix } from '../../storage/repositories/repository-row-repository.ts';
import { listWorkspaceRowsByPathPrefix } from '../../storage/repositories/workspace-repository.ts';
import { deleteWorkspaceRow } from '../workspace-row-ops.ts';
import {
	ensureTrailingSeparator,
	isPathRow,
	markRecordMissing,
} from './internal.ts';

/**
 * Reconciles repository/workspace rows whose filesystem path no longer exists
 * under the managed root.
 *
 * Repository rows are conservative: a missing repo directory may be the result
 * of an unmounted drive or a moved checkout, so the row is preserved with a
 * `missingSince` marker. Workspace rows are aggressive: a workspace lives in
 * the managed workspaces directory and is meant to be cheap to recreate, so a
 * vanished folder is treated as an out-of-band archive and the SQLite row is
 * deleted to keep the sidebar in sync with disk.
 */
export function detectStaleRecords({
	database,
	rootRepositoriesPath,
	rootWorkspacesPath,
	scannedRepositoryPaths,
	scannedWorkspacePaths,
	timestamp,
}: {
	database: DatabaseSync;
	rootRepositoriesPath: string;
	rootWorkspacesPath: string;
	scannedRepositoryPaths: Set<string>;
	scannedWorkspacePaths: Set<string>;
	timestamp: string;
}): {
	repositories: SharedRootAdoptionStaleRepositoryRecord[];
	workspaces: SharedRootAdoptionStaleWorkspaceRecord[];
} {
	const repositoriesPathPrefix = ensureTrailingSeparator(rootRepositoriesPath);
	const workspacesPathPrefix = ensureTrailingSeparator(rootWorkspacesPath);

	const repoRows = listRepositoryRowsByPathPrefix({
		database,
		pathPrefix: repositoriesPathPrefix,
	});
	const wsRows = listWorkspaceRowsByPathPrefix({
		database,
		pathPrefix: workspacesPathPrefix,
	});

	const repositories: SharedRootAdoptionStaleRepositoryRecord[] = [];
	for (const row of repoRows) {
		if (!isPathRow(row)) {
			continue;
		}
		if (!row.path.startsWith(repositoriesPathPrefix)) {
			continue;
		}
		if (scannedRepositoryPaths.has(row.path) || directoryExists(row.path)) {
			continue;
		}
		markRecordMissing({
			database,
			id: row.id,
			metadataJson: row.metadataJson,
			table: 'repositories',
			timestamp,
		});
		repositories.push({ id: row.id, missingSince: timestamp, path: row.path });
	}

	const workspaces: SharedRootAdoptionStaleWorkspaceRecord[] = [];
	for (const row of wsRows) {
		if (!isPathRow(row)) {
			continue;
		}
		if (!row.path.startsWith(workspacesPathPrefix)) {
			continue;
		}
		if (scannedWorkspacePaths.has(row.path) || directoryExists(row.path)) {
			continue;
		}
		deleteWorkspaceRow({ database, id: row.id });
		workspaces.push({ id: row.id, missingSince: timestamp, path: row.path });
	}

	return { repositories, workspaces };
}

/** Confirms a path still names a directory when it appeared after the scan snapshot. */
function directoryExists(candidatePath: string): boolean {
	try {
		return statSync(candidatePath).isDirectory();
	} catch {
		return false;
	}
}
