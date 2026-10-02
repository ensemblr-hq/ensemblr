import { homedir } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';

import type {
	RootDirectoryDiagnostic,
	RootDirectorySnapshot,
} from '../../shared/ipc/contracts/root-directory';
import type { SettingsResolutionSnapshot } from '../../shared/ipc/contracts/settings-resolution';
import { inspectRootDirectory } from './root-inspect.ts';
import {
	createManagedPathSnapshots,
	findRootDirectorySetting,
	normalizeRootPath,
} from './root-path-normalize.ts';
import {
	buildRootDirectorySnapshot,
	persistRootDirectorySnapshot,
} from './root-persist.ts';

/** Options for {@link ensureRootDirectory}. */
export interface EnsureRootDirectoryOptions {
	allowCreate?: boolean;
	database?: DatabaseSync | null;
	homeDirectory?: string;
	now?: () => Date;
	settingsSnapshot: SettingsResolutionSnapshot;
}

/**
 * Resolves the rootDirectory setting, verifies (and optionally creates) the
 * root and its managed subdirectories, then persists the snapshot to SQLite.
 * @param options - Settings snapshot, database, and tuning overrides.
 * @returns A {@link RootDirectorySnapshot}.
 */
export function ensureRootDirectory({
	allowCreate = true,
	database = null,
	homeDirectory = homedir(),
	now = () => new Date(),
	settingsSnapshot,
}: EnsureRootDirectoryOptions): RootDirectorySnapshot {
	const createdPaths: string[] = [];
	const diagnostics: RootDirectoryDiagnostic[] = [];
	const setting = findRootDirectorySetting(settingsSnapshot);
	const normalizedRoot = normalizeRootPath(setting, homeDirectory);

	diagnostics.push(...normalizedRoot.diagnostics);

	const managedPaths = createManagedPathSnapshots(normalizedRoot.path);

	if (normalizedRoot.path) {
		inspectRootDirectory({
			allowCreate,
			createdPaths,
			diagnostics,
			managedPaths,
			rootPath: normalizedRoot.path,
		});
	}

	const snapshot = buildRootDirectorySnapshot({
		createdPaths,
		diagnostics,
		managedPaths,
		rootPath: normalizedRoot.path,
		setting,
		source: setting?.source ?? null,
	});

	persistRootDirectorySnapshot(database, snapshot, now);

	return snapshot;
}
