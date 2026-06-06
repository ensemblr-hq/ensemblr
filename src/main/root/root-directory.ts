import { randomUUID } from 'node:crypto';
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
	RootDirectoryChangeApplyResult,
	RootDirectoryChangePreview,
	RootDirectoryChangeRequest,
	RootDirectoryDiagnostic,
	RootDirectoryManagedPathKey,
	RootDirectoryManagedPathSnapshot,
	RootDirectoryReconciliationSnapshot,
	RootDirectorySnapshot,
	SettingsResolutionSnapshot,
	SettingsResolutionSource,
} from '../../shared/ipc';
import type { EnsembleConfigResolutionService } from '../config/config-resolution';
import type { EnsembleDatabaseService } from '../storage/database';

export interface EnsureRootDirectoryOptions {
	allowCreate?: boolean;
	database?: DatabaseSync | null;
	homeDirectory?: string;
	now?: () => Date;
	settingsSnapshot: SettingsResolutionSnapshot;
}

export interface EnsembleRootDirectoryService {
	applyChange: (
		request: RootDirectoryChangeRequest,
	) => RootDirectoryChangeApplyResult;
	ensure: () => RootDirectorySnapshot;
	getSnapshot: () => RootDirectorySnapshot | null;
	previewChange: (nextRootPath: string) => RootDirectoryChangePreview;
}

interface CreateEnsembleRootDirectoryServiceOptions {
	allowCreate?: boolean;
	databaseService: EnsembleDatabaseService;
	homeDirectory?: string;
	now?: () => Date;
	reconcileRootDirectory?: RootDirectoryReconciler;
	settingsResolutionService: EnsembleConfigResolutionService;
}

type RootDirectoryReconciler = (options: {
	now?: () => Date;
	root: RootDirectorySnapshot;
}) => RootDirectoryReconciliationSnapshot;

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

export function createEnsembleRootDirectoryService({
	allowCreate = true,
	databaseService,
	homeDirectory,
	now,
	reconcileRootDirectory = createEmptyRootDirectoryReconciliation,
	settingsResolutionService,
}: CreateEnsembleRootDirectoryServiceOptions): EnsembleRootDirectoryService {
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
		applyChange: (request) => {
			const previousRoot = snapshot ?? ensure();
			const result = applyRootDirectoryChange({
				database: databaseService.getConnection()?.database ?? null,
				homeDirectory,
				nextRootPath: request.path,
				now,
				previousRoot,
				reconcileRootDirectory,
				resolveSettingsSnapshot: () => settingsResolutionService.resolve(),
			});

			if (result.newRoot) {
				snapshot = result.newRoot;
			}

			return result;
		},
		ensure,
		getSnapshot: () => snapshot,
		previewChange: (nextRootPath) => {
			const previousRoot = snapshot ?? ensure();

			return previewRootDirectoryChange({
				homeDirectory,
				nextRootPath,
				previousRoot,
				settingsSnapshot: settingsResolutionService.resolve(),
			});
		},
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

export function previewRootDirectoryChange({
	homeDirectory = homedir(),
	nextRootPath,
	previousRoot,
	settingsSnapshot,
}: {
	homeDirectory?: string;
	nextRootPath: string;
	previousRoot: RootDirectorySnapshot | null;
	settingsSnapshot: SettingsResolutionSnapshot;
}): RootDirectoryChangePreview {
	const diagnostics: RootDirectoryDiagnostic[] = [];
	const currentSetting = findRootDirectorySetting(settingsSnapshot);
	const newRoot = inspectRootPathValue({
		allowCreate: false,
		homeDirectory,
		missingManagedDirectorySeverity: 'info',
		rootPathValue: nextRootPath,
	});

	if (currentSetting?.locked) {
		diagnostics.push({
			code: 'root-setting-locked',
			message:
				'The rootDirectory setting is locked by managed config and cannot be changed here.',
			severity: 'error',
		});
	}

	diagnostics.push(...newRoot.diagnostics);

	return {
		canApply: !diagnostics.some(
			(diagnostic) => diagnostic.severity === 'error',
		),
		diagnostics,
		newRoot,
		oldRoot: previousRoot,
		oldRootPreserved: true,
	};
}

export function applyRootDirectoryChange({
	database,
	homeDirectory = homedir(),
	nextRootPath,
	now = () => new Date(),
	previousRoot,
	reconcileRootDirectory = createEmptyRootDirectoryReconciliation,
	resolveSettingsSnapshot,
}: {
	database: DatabaseSync | null;
	homeDirectory?: string;
	nextRootPath: string;
	now?: () => Date;
	previousRoot: RootDirectorySnapshot | null;
	reconcileRootDirectory?: RootDirectoryReconciler;
	resolveSettingsSnapshot: () => SettingsResolutionSnapshot;
}): RootDirectoryChangeApplyResult {
	const currentSettings = resolveSettingsSnapshot();
	const preview = previewRootDirectoryChange({
		homeDirectory,
		nextRootPath,
		previousRoot,
		settingsSnapshot: currentSettings,
	});

	if (!preview.canApply) {
		return {
			applied: false,
			error:
				preview.diagnostics.find(
					(diagnostic) => diagnostic.severity === 'error',
				)?.message ?? 'The selected root directory cannot be applied.',
			newRoot: preview.newRoot,
			oldRoot: previousRoot,
			oldRootPreserved: true,
			reconciliation: null,
		};
	}

	if (!database) {
		return {
			applied: false,
			error: 'SQLite is unavailable; the root directory change was not saved.',
			newRoot: preview.newRoot,
			oldRoot: previousRoot,
			oldRootPreserved: true,
			reconciliation: null,
		};
	}

	try {
		saveRootDirectoryOverride({
			database,
			now,
			rootPath: preview.newRoot.path,
		});
	} catch (error) {
		return {
			applied: false,
			error:
				error instanceof Error
					? error.message
					: 'The root directory change was not saved.',
			newRoot: preview.newRoot,
			oldRoot: previousRoot,
			oldRootPreserved: true,
			reconciliation: null,
		};
	}

	const newRoot = ensureRootDirectory({
		allowCreate: true,
		database,
		homeDirectory,
		now,
		settingsSnapshot: resolveSettingsSnapshot(),
	});
	const reconciliation = reconcileRootDirectory({ now, root: newRoot });

	return {
		applied: true,
		error:
			newRoot.status === 'error'
				? (newRoot.diagnostics.find(
						(diagnostic) => diagnostic.severity === 'error',
					)?.message ?? 'The root directory change was saved but setup failed.')
				: undefined,
		newRoot,
		oldRoot: previousRoot,
		oldRootPreserved: true,
		reconciliation,
	};
}

function createEmptyRootDirectoryReconciliation({
	now = () => new Date(),
	root,
}: {
	now?: () => Date;
	root: RootDirectorySnapshot;
}): RootDirectoryReconciliationSnapshot {
	return {
		diagnostics: root.status === 'error' ? root.diagnostics : [],
		repositoryDirectoryCount: 0,
		scannedAt: now().toISOString(),
		status:
			root.status === 'error'
				? 'error'
				: root.status === 'warning'
					? 'warning'
					: 'ok',
		workspaceDirectoryCount: 0,
	};
}

function inspectRootPathValue({
	allowCreate,
	homeDirectory,
	missingManagedDirectorySeverity,
	rootPathValue,
}: {
	allowCreate: boolean;
	homeDirectory: string;
	missingManagedDirectorySeverity?: RootDirectoryDiagnostic['severity'] | null;
	rootPathValue: string;
}): RootDirectorySnapshot {
	const createdPaths: string[] = [];
	const diagnostics: RootDirectoryDiagnostic[] = [];
	const setting = createRootDirectorySettingSnapshot(rootPathValue);
	const normalizedRoot = normalizeRootPath(setting, homeDirectory);

	diagnostics.push(...normalizedRoot.diagnostics);

	const managedPaths = createManagedPathSnapshots(normalizedRoot.path);

	if (normalizedRoot.path) {
		inspectRootDirectory({
			allowCreate,
			createdPaths,
			diagnostics,
			managedPaths,
			missingManagedDirectorySeverity,
			rootPath: normalizedRoot.path,
		});
	}

	return createRootDirectorySnapshot({
		createdPaths,
		diagnostics,
		managedPaths,
		rootPath: normalizedRoot.path,
		setting,
		source: setting.source,
	});
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

function createRootDirectorySettingSnapshot(
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
	missingManagedDirectorySeverity = 'error',
	rootPath,
}: {
	allowCreate: boolean;
	createdPaths: string[];
	diagnostics: RootDirectoryDiagnostic[];
	managedPaths: RootDirectoryManagedPathSnapshot[];
	missingManagedDirectorySeverity?: RootDirectoryDiagnostic['severity'] | null;
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
		missingManagedDirectorySeverity,
	});
}

function inspectManagedDirectories({
	allowCreate,
	createdPaths,
	diagnostics,
	managedPaths,
	missingManagedDirectorySeverity = 'error',
}: {
	allowCreate: boolean;
	createdPaths: string[];
	diagnostics: RootDirectoryDiagnostic[];
	managedPaths: RootDirectoryManagedPathSnapshot[];
	missingManagedDirectorySeverity?: RootDirectoryDiagnostic['severity'] | null;
}): void {
	for (const managedPath of managedPaths) {
		if (!existsSync(managedPath.path)) {
			if (!allowCreate) {
				managedPath.status = 'missing';
				if (missingManagedDirectorySeverity) {
					diagnostics.push({
						code: 'managed-directory-missing',
						message:
							missingManagedDirectorySeverity === 'info'
								? `Managed directory "${managedPath.key}" will be created after confirmation.`
								: `Managed directory "${managedPath.key}" is missing.`,
						path: managedPath.path,
						severity: missingManagedDirectorySeverity,
					});
				}
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

function saveRootDirectoryOverride({
	database,
	now,
	rootPath,
}: {
	database: DatabaseSync;
	now: () => Date;
	rootPath: string;
}): void {
	const timestamp = now().toISOString();

	database
		.prepare(
			`INSERT INTO settings (
				id,
				scope,
				scope_id,
				key,
				value_json,
				source,
				locked,
				updated_at
			)
			VALUES (?, 'app', '', ?, ?, 'sqlite', 0, ?)
			ON CONFLICT(scope, scope_id, key) DO UPDATE SET
				value_json = excluded.value_json,
				source = 'sqlite',
				locked = 0,
				updated_at = excluded.updated_at`,
		)
		.run(
			`setting-${randomUUID()}`,
			ROOT_DIRECTORY_KEY,
			JSON.stringify(rootPath),
			timestamp,
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
