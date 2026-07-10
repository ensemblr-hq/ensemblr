import {
	accessSync,
	constants,
	existsSync,
	mkdirSync,
	realpathSync,
	rmSync,
	statSync,
} from 'node:fs';
import path from 'node:path';

import type {
	RegisterLocalRepositoryDiagnostic,
	RegisterLocalRepositoryRequest,
	RegisterLocalRepositoryResult,
} from '../../shared/ipc/contracts/repository';
import type { LocalCommandService } from '../commands/local-command';
import type { EnsemblrRootDirectoryService } from '../root';
import { firstLine } from './first-line.ts';
import type { LocalRepositoryRegistrationService } from './register-repository.ts';
import { allocateUniqueTargetPath } from './target-path.ts';

/** Public surface for importing a local project into the managed repos root. */
export interface LocalRepositoryImportService {
	importRepository: (
		request: RegisterLocalRepositoryRequest,
	) => Promise<RegisterLocalRepositoryResult>;
}

/** Options for {@link createLocalRepositoryImportService}. */
export interface CreateLocalRepositoryImportServiceOptions {
	localCommandService: LocalCommandService;
	registrationService: LocalRepositoryRegistrationService;
	rootDirectoryService: EnsemblrRootDirectoryService;
}

const EMPTY_SETTINGS_SOURCES = Object.freeze(
	[] as RegisterLocalRepositoryResult['settingsSources'],
) as RegisterLocalRepositoryResult['settingsSources'];

/**
 * Builds the service behind the Open Local Project flow. The selected source
 * folder is copied into the managed `repos/` directory first, then the copy is
 * registered so Ensemblr never mutates the user's original checkout.
 * @param options - Service dependencies and test seams.
 * @returns A local repository import service.
 */
export function createLocalRepositoryImportService({
	localCommandService,
	registrationService,
	rootDirectoryService,
}: CreateLocalRepositoryImportServiceOptions): LocalRepositoryImportService {
	return {
		importRepository: async (request) => {
			const sourceResolution = resolveSourcePath(request.path);
			if (sourceResolution.diagnostic) {
				return failureResult(sourceResolution.diagnostic);
			}

			const sourcePath = sourceResolution.sourcePath;

			const gitDiagnostic = ensureGitRepository(sourcePath);
			if (gitDiagnostic) {
				return failureResult(gitDiagnostic);
			}

			const rootSnapshot =
				rootDirectoryService.getSnapshot() ?? rootDirectoryService.ensure();
			const parentPath = rootSnapshot.repositoriesPath;

			if (!parentPath) {
				return failureResult({
					code: 'managed-repositories-path-missing',
					message:
						'The managed root has no repositories path; configure the root directory first.',
					severity: 'error',
				});
			}

			const parentDiagnostic = ensureWritableDirectory(parentPath);
			if (parentDiagnostic) {
				return failureResult(parentDiagnostic);
			}

			if (isManagedRootInsideSource(sourcePath, parentPath)) {
				return failureResult({
					code: 'repository-copy-target-inside-source',
					message:
						'Choose a project outside the Ensemblr managed root; the import destination would be inside the selected folder.',
					path: parentPath,
					severity: 'error',
				});
			}

			const targetPath = allocateUniqueTargetPath(
				parentPath,
				path.basename(sourcePath) || 'repository',
			);

			const cloneDiagnostic = await cloneTrackedRepository({
				localCommandService,
				sourcePath,
				targetPath,
			});
			if (cloneDiagnostic) {
				cleanupCopiedDirectory(targetPath);
				return failureResult(cloneDiagnostic);
			}

			const registration = await registrationService.register({
				...(request.name ? { name: request.name } : {}),
				path: targetPath,
			});

			if (!registration.registered) {
				cleanupCopiedDirectory(targetPath);
			}

			return registration;
		},
	};
}

/** Result of resolving and validating a caller-provided source path. */
interface SourcePathResolution {
	diagnostic?: RegisterLocalRepositoryDiagnostic;
	sourcePath: string;
}

/**
 * Validates that the source path is absolute, readable, and a directory.
 * @param rawPath - Candidate source path from the renderer.
 * @returns The resolved source path or a diagnostic.
 */
function resolveSourcePath(rawPath: string): SourcePathResolution {
	const trimmedPath = (rawPath ?? '').trim();

	if (!trimmedPath) {
		return {
			diagnostic: {
				code: 'repository-path-missing',
				message: 'No repository path was provided.',
				severity: 'error',
			},
			sourcePath: '',
		};
	}

	if (!path.isAbsolute(trimmedPath)) {
		return {
			diagnostic: {
				code: 'repository-path-relative',
				message: 'The repository path must be absolute.',
				path: trimmedPath,
				severity: 'error',
			},
			sourcePath: trimmedPath,
		};
	}

	const sourcePath = path.resolve(trimmedPath);

	try {
		const stat = statSync(sourcePath);
		if (!stat.isDirectory()) {
			return {
				diagnostic: {
					code: 'repository-path-not-directory',
					message: `${sourcePath} is not a directory.`,
					path: sourcePath,
					severity: 'error',
				},
				sourcePath,
			};
		}
		accessSync(sourcePath, constants.R_OK);
		return { sourcePath };
	} catch (error) {
		return {
			diagnostic: {
				code: isPermissionError(error)
					? 'repository-permission-denied'
					: 'repository-path-unreadable',
				message:
					error instanceof Error
						? error.message
						: 'Failed to access the repository path.',
				path: sourcePath,
				severity: 'error',
			},
			sourcePath,
		};
	}
}

/**
 * Verifies that the source contains a `.git` entry (directory or file, the
 * latter is what submodule worktrees use). Bails before any copy work so the
 * user sees the real reason instead of a generic clone failure.
 */
function ensureGitRepository(
	sourcePath: string,
): RegisterLocalRepositoryDiagnostic | null {
	if (existsSync(path.join(sourcePath, '.git'))) {
		return null;
	}

	return {
		code: 'path-not-a-git-repository',
		message: `${sourcePath} is not a git repository.`,
		path: sourcePath,
		severity: 'error',
	};
}

/**
 * Ensures a directory exists and is writable, creating it when absent.
 * @param directoryPath - Directory that should be writable.
 * @returns A diagnostic when the directory cannot be used.
 */
function ensureWritableDirectory(
	directoryPath: string,
): RegisterLocalRepositoryDiagnostic | null {
	try {
		if (existsSync(directoryPath)) {
			if (!statSync(directoryPath).isDirectory()) {
				return {
					code: 'destination-not-writable',
					message: `${directoryPath} is not a directory.`,
					path: directoryPath,
					severity: 'error',
				};
			}
			accessSync(directoryPath, constants.W_OK);
			return null;
		}
		mkdirSync(directoryPath, { recursive: true });
		return null;
	} catch (error) {
		return {
			code: 'destination-not-writable',
			message:
				error instanceof Error
					? error.message
					: `Ensemblr cannot write into ${directoryPath}.`,
			path: directoryPath,
			severity: 'error',
		};
	}
}

const GIT_CLONE_TIMEOUT_MS = 120_000;

/**
 * Clones only git-tracked repository state into the managed repository path.
 * @param input - Command service plus source and target paths.
 * @returns A diagnostic when git cannot clone the selected project.
 */
async function cloneTrackedRepository({
	localCommandService,
	sourcePath,
	targetPath,
}: {
	localCommandService: LocalCommandService;
	sourcePath: string;
	targetPath: string;
}): Promise<RegisterLocalRepositoryDiagnostic | null> {
	const result = await localCommandService.run({
		args: ['clone', '--local', '--', sourcePath, targetPath],
		command: 'git',
		cwd: path.dirname(targetPath),
		maxOutputBytes: 16 * 1024,
		timeoutMs: GIT_CLONE_TIMEOUT_MS,
	});

	if (result.status === 'success') {
		return null;
	}

	return {
		code: 'repository-copy-failed',
		message:
			firstLine(result.stderr) ||
			result.failure?.message ||
			'Failed to clone the tracked project files into the managed repositories directory.',
		path: targetPath,
		severity: 'error',
	};
}

/** Removes a failed import target best-effort. */
function cleanupCopiedDirectory(targetPath: string): void {
	rmSync(targetPath, { force: true, recursive: true });
}

/**
 * True when the managed repositories root resolves to a path inside the user's
 * selected source folder. Compares realpaths so a symlinked managed root (or a
 * symlinked source) cannot bypass the check, and so case-insensitive
 * filesystems (macOS default, Windows) get canonical comparison.
 */
function isManagedRootInsideSource(
	sourcePath: string,
	parentPath: string,
): boolean {
	const realSource = safeRealpath(sourcePath);
	const realParent = safeRealpath(parentPath);
	const relativePath = path.relative(realSource, realParent);

	return (
		relativePath === '' ||
		(!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
	);
}

/** Returns the canonical path when resolvable; otherwise returns the input. */
function safeRealpath(candidate: string): string {
	try {
		return realpathSync(candidate);
	} catch {
		return candidate;
	}
}

/** Builds the common failure result shape for import failures. */
function failureResult(
	diagnostic: RegisterLocalRepositoryDiagnostic,
): RegisterLocalRepositoryResult {
	return {
		diagnostics: [diagnostic],
		registered: false,
		repository: null,
		settingsSources: EMPTY_SETTINGS_SOURCES,
	};
}

/** True when a filesystem error represents an access denial. */
function isPermissionError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error.code === 'EACCES' || error.code === 'EPERM')
	);
}
