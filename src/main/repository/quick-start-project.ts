import {
	accessSync,
	constants,
	existsSync,
	mkdirSync,
	rmSync,
	statSync,
} from 'node:fs';
import path from 'node:path';

import type { QuickStartProjectDiagnostic, QuickStartProjectRequest, QuickStartProjectResult } from '../../shared/ipc/contracts/quick-start';
import type { LocalCommandService } from '../commands/local-command';
import type { EnsembleRootDirectoryService } from '../root';
import { firstLine } from './first-line.ts';
import type { LocalRepositoryRegistrationService } from './register-repository.ts';
import { allocateUniqueTargetPath } from './target-path.ts';
/** Public surface of the quick-start project service. */
export interface QuickStartProjectService {
	create: (
		request: QuickStartProjectRequest,
	) => Promise<QuickStartProjectResult>;
}

/** Options for {@link createQuickStartProjectService}. */
export interface CreateQuickStartProjectServiceOptions {
	localCommandService: LocalCommandService;
	registrationService: LocalRepositoryRegistrationService;
	rootDirectoryService: EnsembleRootDirectoryService;
}

const PROJECT_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const PROJECT_NAME_MAX_LENGTH = 100;
const GIT_INIT_TIMEOUT_MS = 5000;
const GIT_COMMIT_TIMEOUT_MS = 5000;
const DEFAULT_INITIAL_BRANCH = 'main';

/**
 * Builds the service that scaffolds a brand-new local project: a directory
 * under the managed repos root, `git init` on top, and a repository row in
 * SQLite. Any failure rolls back the freshly created directory so the user can
 * retry without manual cleanup.
 * @param options - Service dependencies.
 * @returns A {@link QuickStartProjectService}.
 */
export function createQuickStartProjectService({
	localCommandService,
	registrationService,
	rootDirectoryService,
}: CreateQuickStartProjectServiceOptions): QuickStartProjectService {
	return {
		create: async (request) => createQuickStartProject(request),
	};

	/**
	 * Validates input, scaffolds the directory, runs `git init`, and registers
	 * the resulting repository, surfacing the first error encountered.
	 */
	async function createQuickStartProject(
		request: QuickStartProjectRequest,
	): Promise<QuickStartProjectResult> {
		const nameDiagnostic = validateName(request.name);
		if (nameDiagnostic) {
			return failureResult({ diagnostic: nameDiagnostic, targetPath: '' });
		}
		const name = request.name.trim();

		const rootSnapshot =
			rootDirectoryService.getSnapshot() ?? rootDirectoryService.ensure();
		const parentResolution = resolveParentPath({
			candidate: request.parentPath,
			fallback: rootSnapshot.repositoriesPath,
		});

		if (parentResolution.diagnostic) {
			return failureResult({
				diagnostic: parentResolution.diagnostic,
				targetPath: '',
			});
		}

		const parentPath = parentResolution.parentPath;
		const targetPath = allocateUniqueTargetPath(parentPath, name);

		const parentReady = ensureParentDirectory(parentPath);
		if (parentReady.diagnostic) {
			return failureResult({
				diagnostic: parentReady.diagnostic,
				targetPath,
			});
		}

		const mkdirDiagnostic = createTargetDirectory(targetPath);
		if (mkdirDiagnostic) {
			return failureResult({ diagnostic: mkdirDiagnostic, targetPath });
		}

		const gitInitDiagnostic = await runGitInit({
			cwd: targetPath,
			localCommandService,
		});
		if (gitInitDiagnostic) {
			cleanupTargetDirectory(targetPath);
			return failureResult({ diagnostic: gitInitDiagnostic, targetPath });
		}

		// Empty initial commit so the default branch has a tip ref. Worktrees
		// created later (`git worktree add -b X path base`) need a real commit
		// to branch from; without this the very first `New workspace` fails.
		const initialCommitDiagnostic = await runInitialCommit({
			cwd: targetPath,
			localCommandService,
		});
		if (initialCommitDiagnostic) {
			cleanupTargetDirectory(targetPath);
			return failureResult({
				diagnostic: initialCommitDiagnostic,
				targetPath,
			});
		}

		const registration = await registrationService.register({
			name,
			path: targetPath,
		});
		if (!registration.registered || !registration.repository) {
			cleanupTargetDirectory(targetPath);
			const reason =
				registration.diagnostics.find(
					(diagnostic) => diagnostic.severity === 'error',
				)?.message ?? 'The new project could not be registered.';
			return failureResult({
				diagnostic: {
					code: 'register-failed',
					message: reason,
					path: targetPath,
					severity: 'error',
				},
				targetPath,
			});
		}

		return {
			diagnostics: [],
			repository: registration.repository,
			status: 'success',
			targetPath,
		};
	}
}

/** Rejects names that contain path separators or unsafe characters. */
function validateName(name: unknown): QuickStartProjectDiagnostic | null {
	if (typeof name !== 'string' || name.trim().length === 0) {
		return {
			code: 'name-required',
			message: 'Enter a project name.',
			severity: 'error',
		};
	}
	const trimmed = name.trim();
	if (trimmed.length > PROJECT_NAME_MAX_LENGTH) {
		return {
			code: 'name-invalid',
			message: `Project names must be ${PROJECT_NAME_MAX_LENGTH} characters or fewer.`,
			severity: 'error',
		};
	}
	if (trimmed === '.' || trimmed === '..' || trimmed.startsWith('.')) {
		return {
			code: 'name-invalid',
			message: 'Project names cannot start with a dot.',
			severity: 'error',
		};
	}
	if (!PROJECT_NAME_PATTERN.test(trimmed)) {
		return {
			code: 'name-invalid',
			message:
				'Project names may only contain letters, numbers, dots, dashes, or underscores.',
			severity: 'error',
		};
	}
	return null;
}

/** Result of {@link resolveParentPath}. */
interface ResolvedParent {
	diagnostic?: QuickStartProjectDiagnostic;
	parentPath: string;
}

/**
 * Picks the absolute parent directory the new project will live under: caller
 * override when provided, otherwise the managed repos path.
 */
function resolveParentPath({
	candidate,
	fallback,
}: {
	candidate: string | undefined;
	fallback: string;
}): ResolvedParent {
	const overrideRaw = typeof candidate === 'string' ? candidate.trim() : '';

	if (overrideRaw) {
		if (!path.isAbsolute(overrideRaw)) {
			return {
				diagnostic: {
					code: 'destination-path-relative',
					message: 'The parent folder path must be absolute.',
					path: overrideRaw,
					severity: 'error',
				},
				parentPath: overrideRaw,
			};
		}
		return { parentPath: path.resolve(overrideRaw) };
	}

	if (!fallback) {
		return {
			diagnostic: {
				code: 'destination-required',
				message:
					'No parent folder was provided and the managed root has no repos path.',
				severity: 'error',
			},
			parentPath: '',
		};
	}

	return { parentPath: path.resolve(fallback) };
}

/**
 * Confirms the parent directory exists (creating it when missing) and is
 * writable; returns a diagnostic when neither is possible.
 */
function ensureParentDirectory(parentPath: string): {
	diagnostic?: QuickStartProjectDiagnostic;
} {
	try {
		if (existsSync(parentPath)) {
			if (!statSync(parentPath).isDirectory()) {
				return {
					diagnostic: {
						code: 'destination-not-writable',
						message: `${parentPath} is not a directory.`,
						path: parentPath,
						severity: 'error',
					},
				};
			}
			accessSync(parentPath, constants.W_OK);
			return {};
		}
		mkdirSync(parentPath, { recursive: true });
		return {};
	} catch (error) {
		return {
			diagnostic: {
				code: 'destination-not-writable',
				message:
					error instanceof Error
						? error.message
						: `Ensemble cannot write into ${parentPath}.`,
				path: parentPath,
				severity: 'error',
			},
		};
	}
}

/** Creates the project's own directory (non-recursive). */
function createTargetDirectory(
	targetPath: string,
): QuickStartProjectDiagnostic | null {
	try {
		mkdirSync(targetPath);
		return null;
	} catch (error) {
		return {
			code: 'mkdir-failed',
			message:
				error instanceof Error
					? error.message
					: `Failed to create ${targetPath}.`,
			path: targetPath,
			severity: 'error',
		};
	}
}

/** Runs `git init -b main` inside the freshly created project directory. */
async function runGitInit({
	cwd,
	localCommandService,
}: {
	cwd: string;
	localCommandService: LocalCommandService;
}): Promise<QuickStartProjectDiagnostic | null> {
	const result = await localCommandService.run({
		args: ['init', '-b', DEFAULT_INITIAL_BRANCH],
		command: 'git',
		cwd,
		maxOutputBytes: 16 * 1024,
		timeoutMs: GIT_INIT_TIMEOUT_MS,
	});

	if (result.status === 'success') {
		return null;
	}

	if (result.failure?.code === 'command-not-found') {
		return {
			code: 'git-not-installed',
			message: 'git was not found in PATH. Install git, then retry.',
			severity: 'error',
		};
	}

	return {
		code: 'git-init-failed',
		message: firstLine(result.stderr) || 'git init failed.',
		path: cwd,
		severity: 'error',
	};
}

/**
 * Records an empty initial commit so the default branch points at a real
 * object. `git worktree add -b <branch> <path> <base>` requires `<base>` to
 * resolve to a commit — a bare `git init` repo doesn't, so workspace creation
 * would fail until the user committed something themselves.
 *
 * `user.name` / `user.email` are passed inline via `-c` so the command works
 * even when the user has no global git identity configured. The values are
 * never written into the repo's own config.
 */
async function runInitialCommit({
	cwd,
	localCommandService,
}: {
	cwd: string;
	localCommandService: LocalCommandService;
}): Promise<QuickStartProjectDiagnostic | null> {
	const result = await localCommandService.run({
		args: [
			'-c',
			'user.name=Ensemble',
			'-c',
			'user.email=ensemble@local',
			'commit',
			'--allow-empty',
			'-m',
			'Initial commit',
		],
		command: 'git',
		cwd,
		maxOutputBytes: 16 * 1024,
		timeoutMs: GIT_COMMIT_TIMEOUT_MS,
	});

	if (result.status === 'success') {
		return null;
	}

	if (result.failure?.code === 'command-not-found') {
		return {
			code: 'git-not-installed',
			message: 'git was not found in PATH. Install git, then retry.',
			severity: 'error',
		};
	}

	return {
		code: 'git-init-failed',
		message: firstLine(result.stderr) || 'git commit --allow-empty failed.',
		path: cwd,
		severity: 'error',
	};
}

/** Removes a half-created project directory so retries do not collide. */
function cleanupTargetDirectory(targetPath: string): void {
	try {
		rmSync(targetPath, { force: true, recursive: true });
	} catch {
		// Best effort: leave any stuck files in place for the user to clean.
	}
}

/** Builds the standardised failure shape used by quick-start. */
function failureResult({
	diagnostic,
	targetPath,
}: {
	diagnostic: QuickStartProjectDiagnostic;
	targetPath: string;
}): QuickStartProjectResult {
	return {
		diagnostics: [diagnostic],
		repository: null,
		status: 'failure',
		targetPath,
	};
}

/** Surfaces the configured initial branch name (so renderer + tests can show it). */
export function getQuickStartInitialBranch(): string {
	return DEFAULT_INITIAL_BRANCH;
}

/** Surfaces the allowed name pattern for renderer-side preview validation. */
export function getQuickStartNameRules(): {
	maxLength: number;
	pattern: RegExp;
} {
	return {
		maxLength: PROJECT_NAME_MAX_LENGTH,
		pattern: PROJECT_NAME_PATTERN,
	};
}
