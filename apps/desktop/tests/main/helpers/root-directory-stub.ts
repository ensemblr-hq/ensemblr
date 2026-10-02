import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type { EnsemblrRootDirectoryService } from '../../../src/main/root';
import type { RootDirectorySnapshot } from '../../../src/shared/ipc';

/**
 * Options for {@link buildRootDirectoryStub}. Provide whichever paths the
 * caller wants to fix; the rest are derived from `rootPath` (or from
 * `repositoriesPath`'s parent when `rootPath` is omitted).
 */
export interface RootDirectoryStubOptions {
	archivedContextsPath?: string;
	conciergePath?: string;
	repositoriesPath?: string;
	rootPath?: string;
	workspacesPath?: string;
}

/**
 * Builds an `EnsemblrRootDirectoryService` test double that returns a fixed
 * `ok` snapshot from `ensure()` / `getSnapshot()` and rejects all
 * `applyChange` / `previewChange` calls. The single source of truth for the
 * stub shape across tests/main/*.
 */
export function buildRootDirectoryStub(
	options: RootDirectoryStubOptions,
): EnsemblrRootDirectoryService {
	const rootPath =
		options.rootPath ??
		(options.repositoriesPath
			? path.dirname(options.repositoriesPath)
			: '/tmp/ensemblr-test-root');
	const repositoriesPath =
		options.repositoriesPath ?? path.join(rootPath, 'repos');
	const workspacesPath =
		options.workspacesPath ?? path.join(rootPath, 'workspaces');
	const archivedContextsPath =
		options.archivedContextsPath ?? path.join(rootPath, 'archived-contexts');
	const conciergePath =
		options.conciergePath ?? path.join(rootPath, 'concierge');

	const snapshot: RootDirectorySnapshot = {
		archivedContextsPath,
		conciergePath,
		createdPaths: [],
		diagnostics: [],
		managedPaths: [],
		path: rootPath,
		repositoriesPath,
		setting: null,
		source: null,
		status: 'ok',
		workspacesPath,
	};

	return {
		applyChange: () => ({
			applied: false,
			newRoot: snapshot,
			oldRoot: snapshot,
			oldRootPreserved: true,
			reconciliation: null,
		}),
		ensure: () => snapshot,
		getSnapshot: () => snapshot,
		previewChange: () => ({
			canApply: false,
			diagnostics: [],
			newRoot: snapshot,
			oldRoot: snapshot,
			oldRootPreserved: true,
		}),
	};
}

/**
 * Writes the `root_directories` row the managed-roots reader consults, so a
 * service that has no root service injected still resolves the same roots the
 * stub reports.
 */
export function persistManagedRootsRow(
	database: DatabaseSync,
	roots: { archivedContextsPath: string; workspacesPath: string },
): void {
	database
		.prepare(
			`INSERT INTO root_directories (
				id, path, source, status,
				repositories_path, workspaces_path, archived_contexts_path,
				concierge_path, last_seen_at, metadata_json
			)
			VALUES ('current', ?, 'built-in-default', 'ok', '', ?, ?, '', ?, '{}')
			ON CONFLICT(id) DO UPDATE SET
				workspaces_path = excluded.workspaces_path,
				archived_contexts_path = excluded.archived_contexts_path`,
		)
		.run(
			path.dirname(roots.workspacesPath),
			roots.workspacesPath,
			roots.archivedContextsPath,
			new Date().toISOString(),
		);
}
