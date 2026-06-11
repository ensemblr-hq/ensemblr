import {
	accessSync,
	constants,
	existsSync,
	mkdirSync,
	readdirSync,
	statSync,
} from 'node:fs';

import type {
	RootDirectoryDiagnostic,
	RootDirectoryManagedPathSnapshot,
	RootDirectorySnapshot,
} from '../../shared/ipc';
import {
	createManagedPathSnapshots,
	createRootDirectorySettingSnapshot,
	IGNORED_ROOT_ENTRY_NAMES,
	MANAGED_DIRECTORY_NAMES,
	normalizeRootPath,
} from './root-path-normalize.ts';
import { buildRootDirectorySnapshot } from './root-persist.ts';

/**
 * Validates and inspects a candidate root path value without depending on the
 * resolved settings snapshot. Used by the root-directory change preview flow.
 * @param input - Candidate path and inspection options.
 * @returns A {@link RootDirectorySnapshot}.
 */
export function inspectRootPathValue({
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

	return buildRootDirectorySnapshot({
		createdPaths,
		diagnostics,
		managedPaths,
		rootPath: normalizedRoot.path,
		setting,
		source: setting.source,
	});
}

/**
 * Inspects the root directory itself plus its managed subdirectories,
 * creating missing entries when `allowCreate` is true and the root is empty.
 * @param input - Inspection options and diagnostic sinks.
 */
export function inspectRootDirectory({
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

/**
 * Inspects each managed subdirectory under the root, creating missing ones when
 * permitted and surfacing existing-content warnings.
 * @param input - Inspection options and diagnostic sinks.
 */
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

/**
 * Warns when a managed subdirectory already contains content (possibly from a
 * shared or previously used root).
 * @param managedPath - Managed-path snapshot.
 * @param diagnostics - Diagnostic sink.
 */
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

/**
 * Creates a directory recursively, recording the path on success or appending
 * a diagnostic on failure.
 * @param directoryPath - Directory to create.
 * @param createdPaths - Sink for successfully-created paths.
 * @param diagnostics - Diagnostic sink.
 * @param errorCode - Diagnostic code for generic failures.
 * @param permissionCode - Diagnostic code for permission failures.
 * @returns True on success.
 */
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

/** Wraps `statSync` with diagnostic-aware error reporting. */
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

/** Wraps `readdirSync` with diagnostic-aware error reporting, returning a sorted list. */
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

/** Records a diagnostic when the directory is not writable. */
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

/** Tests whether a Node.js filesystem error is a permission failure. */
function isPermissionError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error.code === 'EACCES' || error.code === 'EPERM')
	);
}

/** Coerces a thrown filesystem value into a user-facing message. */
function formatFilesystemError(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}
