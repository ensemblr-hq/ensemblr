import path from 'node:path';

import type {
	ResolvedSettingSnapshot,
	RootDirectoryDiagnostic,
	RootDirectoryManagedPathKey,
	RootDirectoryManagedPathSnapshot,
	SettingsResolutionSnapshot,
} from '../../shared/ipc';

/** Setting key used to persist the user-selected root directory. */
export const ROOT_DIRECTORY_KEY = 'rootDirectory';

/** Managed subdirectories created beneath the configured root. */
export const MANAGED_DIRECTORIES: readonly {
	key: RootDirectoryManagedPathKey;
	name: string;
}[] = [
	{ key: 'repos', name: 'repos' },
	{ key: 'workspaces', name: 'workspaces' },
	{
		key: 'archived-contexts',
		name: 'archived-contexts',
	},
];

/** Names of managed directories used to detect unmanaged root content. */
export const MANAGED_DIRECTORY_NAMES = new Set(
	MANAGED_DIRECTORIES.map((directory) => directory.name),
);

/** Filenames that may safely coexist with managed directories at the root. */
export const IGNORED_ROOT_ENTRY_NAMES = new Set(['.DS_Store']);

/** Picks the resolved `rootDirectory` setting from the settings snapshot. */
export function findRootDirectorySetting(
	settingsSnapshot: SettingsResolutionSnapshot,
): ResolvedSettingSnapshot | null {
	return (
		settingsSnapshot.app.settings.find(
			(setting) => setting.key === ROOT_DIRECTORY_KEY,
		) ?? null
	);
}

/** Builds a synthetic setting snapshot used during preview/inspection paths. */
export function createRootDirectorySettingSnapshot(
	rootPathValue: string,
): ResolvedSettingSnapshot {
	return {
		candidates: [
			{
				reason: 'Selected for root directory change preview.',
				source: 'sqlite',
				status: 'selected',
			},
		],
		key: ROOT_DIRECTORY_KEY,
		locked: false,
		source: 'sqlite',
		value: rootPathValue,
	};
}

/**
 * Validates and resolves the `rootDirectory` setting value, expanding `~`.
 * @param setting - Resolved setting (may be null).
 * @param homeDirectory - User home directory.
 * @returns The resolved absolute path plus diagnostics describing any problem.
 */
export function normalizeRootPath(
	setting: ResolvedSettingSnapshot | null,
	homeDirectory: string,
): { diagnostics: RootDirectoryDiagnostic[]; path: string } {
	if (!setting) {
		return {
			diagnostics: [
				{
					code: 'root-setting-missing',
					message: 'The rootDirectory setting could not be resolved.',
					severity: 'error',
				},
			],
			path: '',
		};
	}

	if (typeof setting.value !== 'string') {
		return {
			diagnostics: [
				{
					code: 'root-setting-invalid-type',
					message: 'The rootDirectory setting must be a string path.',
					severity: 'error',
				},
			],
			path: '',
		};
	}

	const rawPath = setting.value.trim();

	if (!rawPath) {
		return {
			diagnostics: [
				{
					code: 'root-setting-empty',
					message: 'The rootDirectory setting cannot be empty.',
					severity: 'error',
				},
			],
			path: '',
		};
	}

	if (rawPath === '~') {
		return { diagnostics: [], path: path.resolve(homeDirectory) };
	}

	if (rawPath.startsWith('~/')) {
		return {
			diagnostics: [],
			path: path.resolve(homeDirectory, rawPath.slice(2)),
		};
	}

	if (!path.isAbsolute(rawPath)) {
		return {
			diagnostics: [
				{
					code: 'root-setting-relative',
					message:
						'The rootDirectory setting must be absolute or start with ~/.',
					severity: 'error',
				},
			],
			path: '',
		};
	}

	return { diagnostics: [], path: path.resolve(rawPath) };
}

/** Builds default `missing` managed-path snapshots under the given root. */
export function createManagedPathSnapshots(
	rootPath: string,
): RootDirectoryManagedPathSnapshot[] {
	return MANAGED_DIRECTORIES.map((directory) => ({
		key: directory.key,
		path: rootPath ? path.join(rootPath, directory.name) : '',
		status: 'missing',
	}));
}
