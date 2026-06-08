import path from 'node:path';

import type { EnsembleRootDirectoryService } from '../../../src/main/root';
import type { RootDirectorySnapshot } from '../../../src/shared/ipc';

/**
 * Options for {@link buildRootDirectoryStub}. Provide whichever paths the
 * caller wants to fix; the rest are derived from `rootPath` (or from
 * `repositoriesPath`'s parent when `rootPath` is omitted).
 */
export interface RootDirectoryStubOptions {
	archivedContextsPath?: string;
	repositoriesPath?: string;
	rootPath?: string;
	workspacesPath?: string;
}

/**
 * Builds an `EnsembleRootDirectoryService` test double that returns a fixed
 * `ok` snapshot from `ensure()` / `getSnapshot()` and rejects all
 * `applyChange` / `previewChange` calls. The single source of truth for the
 * stub shape across tests/main/*.
 */
export function buildRootDirectoryStub(
	options: RootDirectoryStubOptions,
): EnsembleRootDirectoryService {
	const rootPath =
		options.rootPath ??
		(options.repositoriesPath
			? path.dirname(options.repositoriesPath)
			: '/tmp/ensemble-test-root');
	const repositoriesPath =
		options.repositoriesPath ?? path.join(rootPath, 'repos');
	const workspacesPath =
		options.workspacesPath ?? path.join(rootPath, 'workspaces');
	const archivedContextsPath =
		options.archivedContextsPath ?? path.join(rootPath, 'archived-contexts');

	const snapshot: RootDirectorySnapshot = {
		archivedContextsPath,
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
