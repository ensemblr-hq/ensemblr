import type { DatabaseSync } from 'node:sqlite';

import type {
	CreatedWorkspaceSnapshot,
	RenameWorkspaceDiagnostic,
	RenameWorkspaceDiagnosticCode,
	RenameWorkspaceRequest,
	RenameWorkspaceResult,
} from '../../shared/ipc/contracts/workspace';
import type { LocalCommandService } from '../commands/local-command';
import type { EnsembleDatabaseService } from '../storage/database.ts';
import {
	selectWorkspaceWithRepositoryById,
	updateWorkspaceRenameRow,
	workspaceNameCollisionExists,
} from '../storage/repositories/workspace-repository.ts';
import { withTransaction } from '../storage/tx.ts';
import { firstLine } from './first-line.ts';
import { parseMetadata } from './metadata.ts';
import { toSlug } from './slug.ts';
import { validateWorkspaceName as validateWorkspaceNameShared } from './workspace-validation.ts';
/** Public surface of the workspace rename service. */
export interface RenameWorkspaceService {
	rename: (request: RenameWorkspaceRequest) => Promise<RenameWorkspaceResult>;
}

/** Options for {@link createRenameWorkspaceService}. */
export interface CreateRenameWorkspaceServiceOptions {
	databaseService: EnsembleDatabaseService;
	localCommandService: LocalCommandService;
	now?: () => Date;
}

/** Internal: source workspace row joined with parent repository fields. */
interface SourceWorkspace {
	baseBranch: string | null;
	branchName: string | null;
	createdAt: string;
	id: string;
	metadataJson: string;
	name: string;
	path: string;
	repositoryId: string;
	repositoryPath: string;
	slug: string;
}

const BRANCH_NAME_MAX_LENGTH = 255;
const GIT_BRANCH_TIMEOUT_MS = 5_000;

/**
 * Builds the service that renames an existing workspace.
 *
 * Rename intentionally does NOT touch the filesystem: the worktree folder and
 * its SQLite `path`/`slug` columns are stable identities used by terminals,
 * editors, and scripts. Only the display `name`, the underlying git branch,
 * and the rename audit metadata change.
 * @param options - Service dependencies.
 * @returns A {@link RenameWorkspaceService}.
 */
export function createRenameWorkspaceService({
	databaseService,
	localCommandService,
	now = () => new Date(),
}: CreateRenameWorkspaceServiceOptions): RenameWorkspaceService {
	return {
		rename: async (request) => {
			const database = databaseService.getConnection()?.database;
			if (!database) {
				return failure({
					code: 'database-unavailable',
					message: 'SQLite is unavailable; the workspace was not renamed.',
					severity: 'error',
				});
			}

			const workspaceId =
				typeof request.workspaceId === 'string'
					? request.workspaceId.trim()
					: '';
			if (!workspaceId) {
				return failure({
					code: 'workspace-not-found',
					message: 'A workspace id is required to rename a workspace.',
					severity: 'error',
				});
			}

			const source = readWorkspace(database, workspaceId);
			if (!source) {
				return failure({
					code: 'workspace-not-found',
					message: `No workspace is registered with id ${workspaceId}.`,
					severity: 'error',
				});
			}

			const nextName = normalizeName(request.name, source.name);
			const nameDiagnostic = validateWorkspaceName(nextName);
			if (nameDiagnostic) {
				return failure(nameDiagnostic);
			}

			const isNameChanging = nextName !== source.name;
			// When the caller does not provide an explicit branchName but the name
			// is changing, slugify the new name and use it as the branch — keeps
			// the workspace label and its branch in sync without an extra prompt.
			const explicitBranch = normalizeBranchName(request.branchName);
			const derivedBranch =
				explicitBranch === null && isNameChanging
					? toRenameSlug(nextName)
					: null;
			const nextBranch = explicitBranch ?? derivedBranch;
			const branchDiagnostic = nextBranch
				? validateBranchName(nextBranch)
				: null;
			if (branchDiagnostic) {
				return failure(branchDiagnostic);
			}

			const isBranchChanging =
				nextBranch !== null && nextBranch !== source.branchName;

			if (!isBranchChanging && !isNameChanging) {
				return noOpResult(source, now);
			}

			if (
				isNameChanging &&
				nameCollidesInRepository(database, source, nextName)
			) {
				return failure({
					code: 'name-already-in-use',
					message:
						'Another workspace in this repository already uses that name.',
					severity: 'error',
				});
			}

			let branchRenamed = false;
			if (isBranchChanging && nextBranch && source.branchName) {
				const diagnostic = await runBranchRename({
					localCommandService,
					newBranch: nextBranch,
					oldBranch: source.branchName,
					repositoryPath: source.repositoryPath,
				});
				if (diagnostic) {
					return failure(diagnostic);
				}
				branchRenamed = true;
			}

			const timestamp = now().toISOString();
			const resolvedBranchName = isBranchChanging
				? nextBranch
				: source.branchName;
			try {
				updateWorkspaceRow({
					branchName: resolvedBranchName,
					database,
					id: source.id,
					metadataJson: source.metadataJson,
					name: nextName,
					timestamp,
				});
			} catch (error) {
				if (branchRenamed && source.branchName && nextBranch) {
					await runBranchRename({
						localCommandService,
						newBranch: source.branchName,
						oldBranch: nextBranch,
						repositoryPath: source.repositoryPath,
					});
				}
				return failure({
					code: 'workspace-update-failed',
					message:
						error instanceof Error
							? error.message
							: 'Failed to write the rename to SQLite.',
					severity: 'error',
				});
			}

			const workspace: CreatedWorkspaceSnapshot = {
				archivedAt: null,
				baseBranch: source.baseBranch,
				branchName: resolvedBranchName,
				createdAt: source.createdAt,
				id: source.id,
				metadata: parseMetadata(source.metadataJson),
				name: nextName,
				path: source.path,
				repositoryId: source.repositoryId,
				slug: source.slug,
				updatedAt: timestamp,
			};

			return {
				diagnostics: [],
				status: 'success',
				workspace,
			};
		},
	};
}

/**
 * Loads the workspace row joined with the parent repository path. Returns
 * `null` when the workspace cannot be resolved.
 */
function readWorkspace(
	database: DatabaseSync,
	workspaceId: string,
): SourceWorkspace | null {
	const row = selectWorkspaceWithRepositoryById({ database, workspaceId });

	if (!isWorkspaceRow(row)) {
		return null;
	}
	return row;
}

/** Validates `name`, returning a diagnostic when the input is rejected. */
function validateWorkspaceName(name: string): RenameWorkspaceDiagnostic | null {
	const result = validateWorkspaceNameShared(name);
	if (result.valid) {
		return null;
	}
	return {
		code: 'name-invalid',
		message: result.message,
		severity: 'error',
	};
}

/** Validates `branchName`, returning a diagnostic when the input is rejected. */
function validateBranchName(branch: string): RenameWorkspaceDiagnostic | null {
	if (branch.length > BRANCH_NAME_MAX_LENGTH) {
		return {
			code: 'name-invalid',
			message: 'Branch names must be 255 characters or fewer.',
			severity: 'error',
		};
	}
	if (/\s/.test(branch) || branch.includes('..') || branch.startsWith('-')) {
		return {
			code: 'name-invalid',
			message: 'Branch name contains invalid characters.',
			severity: 'error',
		};
	}
	return null;
}

/** Tests whether another workspace in the same repository already uses `name`. */
function nameCollidesInRepository(
	database: DatabaseSync,
	source: SourceWorkspace,
	name: string,
): boolean {
	return workspaceNameCollisionExists({
		database,
		excludeId: source.id,
		name,
		repositoryId: source.repositoryId,
	});
}

/**
 * Runs `git branch -m <old> <new>` inside the parent repository.
 *
 * Surfaces a `branch-already-exists` diagnostic when the destination branch
 * is already present, and `branch-rename-failed` otherwise.
 */
async function runBranchRename({
	localCommandService,
	newBranch,
	oldBranch,
	repositoryPath,
}: {
	localCommandService: LocalCommandService;
	newBranch: string;
	oldBranch: string;
	repositoryPath: string;
}): Promise<RenameWorkspaceDiagnostic | null> {
	const result = await localCommandService.run({
		args: ['branch', '-m', oldBranch, newBranch],
		command: 'git',
		cwd: repositoryPath,
		maxOutputBytes: 16 * 1024,
		timeoutMs: GIT_BRANCH_TIMEOUT_MS,
	});

	if (result.status === 'success') {
		return null;
	}

	const stderr = result.stderr || '';
	if (stderr.includes('already exists') || stderr.includes('already used')) {
		return {
			code: 'branch-already-exists',
			message: `Branch "${newBranch}" already exists.`,
			severity: 'error',
		};
	}

	return {
		code: 'branch-rename-failed',
		message: firstLine(stderr) || 'git branch -m failed.',
		severity: 'error',
	};
}

/** Updates the `workspaces` row in a single transaction. */
function updateWorkspaceRow({
	branchName,
	database,
	id,
	metadataJson,
	name,
	timestamp,
}: {
	branchName: string | null;
	database: DatabaseSync;
	id: string;
	metadataJson: string;
	name: string;
	timestamp: string;
}): void {
	withTransaction(database, () => {
		updateWorkspaceRenameRow({
			branchName,
			database,
			id,
			metadataJson: bumpRenameMetadata(metadataJson, timestamp),
			name,
			timestamp,
		});
	});
}

/** Stamps `metadata.renamedAt` so consumers can see when the rename happened. */
function bumpRenameMetadata(metadataJson: string, timestamp: string): string {
	const existing = parseMetadata(metadataJson);
	const next = {
		...existing,
		renamedAt: timestamp,
	};
	return JSON.stringify(next);
}

/** Builds the standard failure shape for any rejected rename request. */
function failure(diagnostic: RenameWorkspaceDiagnostic): RenameWorkspaceResult {
	return {
		diagnostics: [diagnostic],
		status: 'failure',
		workspace: null,
	};
}

/** Returns a success result that did not mutate anything because input matched. */
function noOpResult(
	source: SourceWorkspace,
	now: () => Date,
): RenameWorkspaceResult {
	const timestamp = now().toISOString();
	return {
		diagnostics: [],
		status: 'success',
		workspace: {
			archivedAt: null,
			baseBranch: source.baseBranch,
			branchName: source.branchName,
			createdAt: source.createdAt,
			id: source.id,
			metadata: parseMetadata(source.metadataJson),
			name: source.name,
			path: source.path,
			repositoryId: source.repositoryId,
			slug: source.slug,
			updatedAt: timestamp,
		},
	};
}

/** Picks the trimmed `request.name` or falls back to the current name. */
function normalizeName(input: unknown, fallback: string): string {
	if (typeof input !== 'string') {
		return fallback;
	}
	const trimmed = input.trim();
	return trimmed.length > 0 ? trimmed : fallback;
}

/** Picks the trimmed `request.branchName` or returns `null` when absent. */
function normalizeBranchName(input: unknown): string | null {
	if (typeof input !== 'string') {
		return null;
	}
	const trimmed = input.trim();
	return trimmed.length > 0 ? trimmed : null;
}

/** Normalises a value into a URL-safe slug used as the derived branch name. */
function toRenameSlug(value: string): string {
	return toSlug(value, 'workspace');
}

/** Type guard for the joined workspace+repository lookup row. */
function isWorkspaceRow(row: unknown): row is {
	baseBranch: string | null;
	branchName: string | null;
	createdAt: string;
	id: string;
	metadataJson: string;
	name: string;
	path: string;
	repositoryId: string;
	repositoryPath: string;
	slug: string;
} {
	if (typeof row !== 'object' || row === null) {
		return false;
	}
	const candidate = row as Record<string, unknown>;
	return (
		typeof candidate.id === 'string' &&
		typeof candidate.name === 'string' &&
		typeof candidate.slug === 'string' &&
		typeof candidate.path === 'string' &&
		typeof candidate.createdAt === 'string' &&
		typeof candidate.metadataJson === 'string' &&
		typeof candidate.repositoryId === 'string' &&
		typeof candidate.repositoryPath === 'string' &&
		(candidate.branchName === null ||
			typeof candidate.branchName === 'string') &&
		(candidate.baseBranch === null || typeof candidate.baseBranch === 'string')
	);
}

/** Diagnostic type re-export for IPC handler normalisation. */
export type { RenameWorkspaceDiagnosticCode };
