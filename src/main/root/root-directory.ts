import {
	accessSync,
	constants,
	existsSync,
	mkdirSync,
	readdirSync,
	statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type {
	ResolvedSettingSnapshot,
	RootDirectoryDiagnostic,
	RootDirectoryManagedPathKey,
	RootDirectoryManagedPathSnapshot,
	RootDirectorySnapshot,
	SettingsResolutionSnapshot,
	SettingsResolutionSource,
} from '../../shared/ipc';
import type { PiductorConfigResolutionService } from '../config/config-resolution';
import type { PiductorDatabaseService } from '../storage/database';

export interface EnsureRootDirectoryOptions {
	allowCreate?: boolean;
	database?: DatabaseSync | null;
	homeDirectory?: string;
	now?: () => Date;
	settingsSnapshot: SettingsResolutionSnapshot;
}

export interface PiductorRootDirectoryService {
	ensure: () => RootDirectorySnapshot;
	getSnapshot: () => RootDirectorySnapshot | null;
}

interface CreatePiductorRootDirectoryServiceOptions {
	allowCreate?: boolean;
	databaseService: PiductorDatabaseService;
	homeDirectory?: string;
	now?: () => Date;
	settingsResolutionService: PiductorConfigResolutionService;
}

const CURRENT_ROOT_ID = 'current';
const ROOT_DIRECTORY_KEY = 'rootDirectory';
const MANAGED_DIRECTORIES: readonly {
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
const MANAGED_DIRECTORY_NAMES = new Set(
	MANAGED_DIRECTORIES.map((directory) => directory.name),
);
const IGNORED_ROOT_ENTRY_NAMES = new Set(['.DS_Store']);

export function createPiductorRootDirectoryService({
	allowCreate = true,
	databaseService,
	homeDirectory,
	now,
	settingsResolutionService,
}: CreatePiductorRootDirectoryServiceOptions): PiductorRootDirectoryService {
	let snapshot: RootDirectorySnapshot | null = null;

	function ensure(): RootDirectorySnapshot {
		snapshot = ensureRootDirectory({
			allowCreate,
			database: databaseService.getConnection()?.database ?? null,
			homeDirectory,
			now,
			settingsSnapshot: settingsResolutionService.resolve(),
		});

		return snapshot;
	}

	return {
		ensure,
		getSnapshot: () => snapshot,
	};
}

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

	const snapshot = createRootDirectorySnapshot({
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

function findRootDirectorySetting(
	settingsSnapshot: SettingsResolutionSnapshot,
): ResolvedSettingSnapshot | null {
	return (
		settingsSnapshot.app.settings.find(
			(setting) => setting.key === ROOT_DIRECTORY_KEY,
		) ?? null
	);
}

function normalizeRootPath(
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

function createManagedPathSnapshots(
	rootPath: string,
): RootDirectoryManagedPathSnapshot[] {
	return MANAGED_DIRECTORIES.map((directory) => ({
		key: directory.key,
		path: rootPath ? path.join(rootPath, directory.name) : '',
		status: 'missing',
	}));
}

function inspectRootDirectory({
	allowCreate,
	createdPaths,
	diagnostics,
	managedPaths,
	rootPath,
}: {
	allowCreate: boolean;
	createdPaths: string[];
	diagnostics: RootDirectoryDiagnostic[];
	managedPaths: RootDirectoryManagedPathSnapshot[];
	rootPath: string;
}): void {
	if (!existsSync(rootPath)) {
		if (!allowCreate) {
			diagnostics.push({
				code: 'root-missing',
				message: 'The configured root directory does not exist.',
				path: rootPath,
				severity: 'error',
			});
			return;
		}

		if (
			!createDirectory(
				rootPath,
				createdPaths,
				diagnostics,
				'root-create-failed',
				'root-unwritable',
			)
		) {
			return;
		}
	}

	const rootStats = getDirectoryStats(
		rootPath,
		diagnostics,
		'root-stat-failed',
	);

	if (!rootStats) {
		return;
	}

	if (!rootStats.isDirectory()) {
		diagnostics.push({
			code: 'root-not-directory',
			message: 'The configured root path exists but is not a directory.',
			path: rootPath,
			severity: 'error',
		});
		return;
	}

	assertWritable(rootPath, diagnostics, 'root-unwritable');

	const rootEntries = readDirectoryEntries(
		rootPath,
		diagnostics,
		'root-read-failed',
		'root-unwritable',
	);

	if (!rootEntries) {
		return;
	}

	const unsafeEntries = rootEntries.filter(
		(entryName) =>
			!MANAGED_DIRECTORY_NAMES.has(entryName) &&
			!IGNORED_ROOT_ENTRY_NAMES.has(entryName),
	);
	const hasUnsafeContent = unsafeEntries.length > 0;

	if (hasUnsafeContent) {
		diagnostics.push({
			code: 'unsafe-root-content',
			message: `Root contains unmanaged top-level content: ${unsafeEntries.join(', ')}.`,
			path: rootPath,
			severity: 'error',
		});
	}

	inspectManagedDirectories({
		allowCreate: allowCreate && !hasUnsafeContent,
		createdPaths,
		diagnostics,
		managedPaths,
	});
}

function inspectManagedDirectories({
	allowCreate,
	createdPaths,
	diagnostics,
	managedPaths,
}: {
	allowCreate: boolean;
	createdPaths: string[];
	diagnostics: RootDirectoryDiagnostic[];
	managedPaths: RootDirectoryManagedPathSnapshot[];
}): void {
	for (const managedPath of managedPaths) {
		if (!existsSync(managedPath.path)) {
			if (!allowCreate) {
				managedPath.status = 'missing';
				diagnostics.push({
					code: 'managed-directory-missing',
					message: `Managed directory "${managedPath.key}" is missing.`,
					path: managedPath.path,
					severity: 'error',
				});
				continue;
			}

			if (
				createDirectory(
					managedPath.path,
					createdPaths,
					diagnostics,
					'managed-directory-create-failed',
					'managed-directory-unwritable',
				)
			) {
				managedPath.status = 'created';
			}
			continue;
		}

		const managedStats = getDirectoryStats(
			managedPath.path,
			diagnostics,
			'managed-directory-stat-failed',
		);

		if (!managedStats) {
			managedPath.status = 'invalid';
			continue;
		}

		if (!managedStats.isDirectory()) {
			managedPath.status = 'invalid';
			diagnostics.push({
				code: 'managed-path-not-directory',
				message: `Managed path "${managedPath.key}" exists but is not a directory.`,
				path: managedPath.path,
				severity: 'error',
			});
			continue;
		}

		managedPath.status = 'present';
		assertWritable(
			managedPath.path,
			diagnostics,
			'managed-directory-unwritable',
		);
		detectSharedManagedContent(managedPath, diagnostics);
	}
}

function detectSharedManagedContent(
	managedPath: RootDirectoryManagedPathSnapshot,
	diagnostics: RootDirectoryDiagnostic[],
): void {
	const entries = readDirectoryEntries(
		managedPath.path,
		diagnostics,
		'managed-directory-read-failed',
		'managed-directory-unwritable',
	);

	if (!entries || entries.length === 0) {
		return;
	}

	diagnostics.push({
		code: 'shared-root-content',
		message: `Managed directory "${managedPath.key}" already contains content; it may be a shared or previously used root.`,
		path: managedPath.path,
		severity: 'warning',
	});
}

function createDirectory(
	directoryPath: string,
	createdPaths: string[],
	diagnostics: RootDirectoryDiagnostic[],
	errorCode: string,
	permissionCode = errorCode,
): boolean {
	try {
		mkdirSync(directoryPath, { recursive: true });
		createdPaths.push(directoryPath);
		return true;
	} catch (error) {
		diagnostics.push({
			code: isPermissionError(error) ? permissionCode : errorCode,
			message: formatFilesystemError(error, 'Failed to create directory.'),
			path: directoryPath,
			severity: 'error',
		});
		return false;
	}
}

function getDirectoryStats(
	directoryPath: string,
	diagnostics: RootDirectoryDiagnostic[],
	errorCode: string,
) {
	try {
		return statSync(directoryPath);
	} catch (error) {
		diagnostics.push({
			code: errorCode,
			message: formatFilesystemError(error, 'Failed to inspect directory.'),
			path: directoryPath,
			severity: 'error',
		});
		return null;
	}
}

function readDirectoryEntries(
	directoryPath: string,
	diagnostics: RootDirectoryDiagnostic[],
	errorCode: string,
	permissionCode = errorCode,
): string[] | null {
	try {
		return readdirSync(directoryPath).sort();
	} catch (error) {
		diagnostics.push({
			code: isPermissionError(error) ? permissionCode : errorCode,
			message: formatFilesystemError(error, 'Failed to read directory.'),
			path: directoryPath,
			severity: 'error',
		});
		return null;
	}
}

function assertWritable(
	directoryPath: string,
	diagnostics: RootDirectoryDiagnostic[],
	errorCode: string,
): void {
	try {
		accessSync(directoryPath, constants.W_OK);
	} catch (error) {
		diagnostics.push({
			code: errorCode,
			message: formatFilesystemError(error, 'Directory is not writable.'),
			path: directoryPath,
			severity: 'error',
		});
	}
}

function createRootDirectorySnapshot({
	createdPaths,
	diagnostics,
	managedPaths,
	rootPath,
	setting,
	source,
}: {
	createdPaths: string[];
	diagnostics: RootDirectoryDiagnostic[];
	managedPaths: RootDirectoryManagedPathSnapshot[];
	rootPath: string;
	setting: ResolvedSettingSnapshot | null;
	source: SettingsResolutionSource | null;
}): RootDirectorySnapshot {
	const status = diagnostics.some(
		(diagnostic) => diagnostic.severity === 'error',
	)
		? 'error'
		: diagnostics.some((diagnostic) => diagnostic.severity === 'warning')
			? 'warning'
			: 'ok';
	const managedPathByKey = new Map(
		managedPaths.map((managedPath) => [managedPath.key, managedPath.path]),
	);

	return {
		archivedContextsPath: managedPathByKey.get('archived-contexts') ?? '',
		createdPaths,
		diagnostics,
		managedPaths,
		path: rootPath,
		repositoriesPath: managedPathByKey.get('repos') ?? '',
		setting,
		source,
		status,
		workspacesPath: managedPathByKey.get('workspaces') ?? '',
	};
}

function persistRootDirectorySnapshot(
	database: DatabaseSync | null,
	snapshot: RootDirectorySnapshot,
	now: () => Date,
): void {
	if (!database || !snapshot.path || !snapshot.source) {
		return;
	}

	const timestamp = now().toISOString();

	database
		.prepare(
			`INSERT INTO root_directories (
				id,
				path,
				source,
				status,
				repositories_path,
				workspaces_path,
				archived_contexts_path,
				last_seen_at,
				metadata_json
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				path = excluded.path,
				source = excluded.source,
				status = excluded.status,
				repositories_path = excluded.repositories_path,
				workspaces_path = excluded.workspaces_path,
				archived_contexts_path = excluded.archived_contexts_path,
				last_seen_at = excluded.last_seen_at,
				metadata_json = excluded.metadata_json`,
		)
		.run(
			CURRENT_ROOT_ID,
			snapshot.path,
			snapshot.source,
			snapshot.status,
			snapshot.repositoriesPath,
			snapshot.workspacesPath,
			snapshot.archivedContextsPath,
			timestamp,
			JSON.stringify({
				createdPaths: snapshot.createdPaths,
				diagnostics: snapshot.diagnostics,
				managedPaths: snapshot.managedPaths,
				setting: snapshot.setting
					? {
							candidates: snapshot.setting.candidates,
							locked: snapshot.setting.locked,
							source: snapshot.setting.source,
						}
					: null,
			}),
		);
}

function isPermissionError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error.code === 'EACCES' || error.code === 'EPERM')
	);
}

function formatFilesystemError(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}
