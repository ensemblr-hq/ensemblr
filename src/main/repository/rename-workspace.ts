import type { DatabaseSync } from 'node:sqlite';

import type {
	CreatedWorkspaceSnapshot,
	RenameWorkspaceDiagnostic,
	RenameWorkspaceDiagnosticCode,
	RenameWorkspaceRequest,
	RenameWorkspaceResult,
} from '../../shared/ipc/contracts/workspace';
import type { LocalCommandService } from '../commands/local-command';
import type { EnsemblrDatabaseService } from '../storage';
import {
	selectWorkspaceWithRepositoryById,
	updateWorkspaceRenameRow,
	workspaceNameCollisionExists,
} from '../storage/repositories/workspace-repository.ts';
import { withTransaction } from '../storage/tx.ts';
import { firstLine } from './first-line.ts';
import { parseMetadata } from './metadata.ts';
import { toSlug } from './slug.ts';
import { validateGitRef } from './validate-git-ref.ts';
import { validateWorkspaceName as validateWorkspaceNameShared } from './workspace-validation.ts';
/** Public surface of the workspace rename service. */
export interface RenameWorkspaceService {
	rename: (request: RenameWorkspaceRequest) => Promise<RenameWorkspaceResult>;
}

/** Options for {@link createRenameWorkspaceService}. */
export interface CreateRenameWorkspaceServiceOptions {
	databaseService: EnsemblrDatabaseService;
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

			const plan = planRename({ database, request, source });
			if (plan.kind === 'no-op') {
				return noOpResult(source, now);
			}
			if (plan.kind === 'reject') {
				return failure(plan.diagnostic);
			}

			let branchRenamed = false;
			if (plan.isBranchChanging && plan.nextBranch && source.branchName) {
				const diagnostic = await runBranchRename({
					localCommandService,
					newBranch: plan.nextBranch,
					oldBranch: source.branchName,
					repositoryPath: source.repositoryPath,
				});
				if (diagnostic) {
					return failure(diagnostic);
				}
				branchRenamed = true;
			}

			const timestamp = now().toISOString();
			const resolvedBranchName = plan.isBranchChanging
				? plan.nextBranch
				: source.branchName;
			const writeDiagnostic = await writeRenamedRow({
				branchName: resolvedBranchName,
				database,
				localCommandService,
				name: plan.nextName,
				rollbackBranch:
					branchRenamed && source.branchName && plan.nextBranch
						? { from: plan.nextBranch, to: source.branchName }
						: null,
				source,
				timestamp,
			});
			if (writeDiagnostic) {
				return failure(writeDiagnostic);
			}

			const workspace: CreatedWorkspaceSnapshot = {
				archivedAt: null,
				baseBranch: source.baseBranch,
				branchName: resolvedBranchName,
				createdAt: source.createdAt,
				id: source.id,
				metadata: parseMetadata(source.metadataJson),
				name: plan.nextName,
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
 * What a validated rename request resolves to: the name and branch to write, a
 * request that changes nothing, or a diagnostic that rejects it.
 */
type RenamePlan =
	| {
			kind: 'apply';
			isBranchChanging: boolean;
			nextBranch: string | null;
			nextName: string;
	  }
	| { kind: 'no-op' }
	| { kind: 'reject'; diagnostic: RenameWorkspaceDiagnostic };

/**
 * Validate a rename request against the stored row and resolve the name and
 * branch it should land on.
 * @param database - Open database handle, used for the name-collision check
 * @param request - The incoming rename request
 * @param source - The workspace row as it currently stands
 * @returns The plan to apply, or the reason the rename does nothing
 */
function planRename({
	database,
	request,
	source,
}: {
	database: DatabaseSync;
	request: RenameWorkspaceRequest;
	source: SourceWorkspace;
}): RenamePlan {
	// Race guard for automatic branch-naming: re-check the placeholder gate
	// against the freshly-read row, synchronously before any await, so a user
	// rename that landed since the caller's pre-flight check wins and this
	// attempt no-ops instead of clobbering it.
	if (
		request.requirePlaceholderName &&
		!placeholderRenameEligible(source.metadataJson)
	) {
		return { kind: 'no-op' };
	}

	const nextName = normalizeName(request.name, source.name);
	const nameDiagnostic = validateWorkspaceName(nextName);
	if (nameDiagnostic) {
		return { diagnostic: nameDiagnostic, kind: 'reject' };
	}

	const isNameChanging = nextName !== source.name;
	// When the caller does not provide an explicit branchName but the name is
	// changing, slugify the new name and use it as the branch — keeps the
	// workspace label and its branch in sync without an extra prompt.
	const explicitBranch = normalizeBranchName(request.branchName);
	const derivedBranch =
		explicitBranch === null && isNameChanging ? toRenameSlug(nextName) : null;
	const nextBranch = explicitBranch ?? derivedBranch;
	const branchDiagnostic = nextBranch ? validateBranchName(nextBranch) : null;
	if (branchDiagnostic) {
		return { diagnostic: branchDiagnostic, kind: 'reject' };
	}

	const isBranchChanging =
		nextBranch !== null && nextBranch !== source.branchName;
	if (!isBranchChanging && !isNameChanging) {
		return { kind: 'no-op' };
	}

	if (isNameChanging && nameCollidesInRepository(database, source, nextName)) {
		return {
			diagnostic: {
				code: 'name-already-in-use',
				message: 'Another workspace in this repository already uses that name.',
				severity: 'error',
			},
			kind: 'reject',
		};
	}

	return { isBranchChanging, kind: 'apply', nextBranch, nextName };
}

/**
 * Persist the renamed row, undoing an already-applied git branch rename when
 * the write fails so the branch and the database stay in agreement.
 * @param branchName - Branch the row should end on
 * @param database - Open database handle
 * @param localCommandService - Command runner used for the rollback git call
 * @param name - Display name the row should end on
 * @param rollbackBranch - Branch rename to undo on failure, or null when none was applied
 * @param source - The workspace row as it currently stands
 * @param timestamp - Rename timestamp written to the row
 * @returns A diagnostic when the write failed, or null on success
 */
async function writeRenamedRow({
	branchName,
	database,
	localCommandService,
	name,
	rollbackBranch,
	source,
	timestamp,
}: {
	branchName: string | null;
	database: DatabaseSync;
	localCommandService: LocalCommandService;
	name: string;
	rollbackBranch: { from: string; to: string } | null;
	source: SourceWorkspace;
	timestamp: string;
}): Promise<RenameWorkspaceDiagnostic | null> {
	try {
		updateWorkspaceRow({
			branchName,
			database,
			id: source.id,
			metadataJson: source.metadataJson,
			name,
			timestamp,
		});
		return null;
	} catch (error) {
		if (rollbackBranch) {
			await runBranchRename({
				localCommandService,
				newBranch: rollbackBranch.to,
				oldBranch: rollbackBranch.from,
				repositoryPath: source.repositoryPath,
			});
		}
		return {
			code: 'workspace-update-failed',
			message:
				error instanceof Error
					? error.message
					: 'Failed to write the rename to SQLite.',
			severity: 'error',
		};
	}
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
	const rejection = validateGitRef(branch);
	if (!rejection) {
		return null;
	}
	return {
		code: 'name-invalid',
		message: rejection.message,
		severity: 'error',
	};
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

/**
 * Tests whether a workspace still qualifies for an automatic placeholder
 * rename: it must carry the `placeholderName` flag and never have been renamed.
 * @param metadataJson - The workspace's stored metadata JSON.
 * @returns True when an auto rename may proceed.
 */
function placeholderRenameEligible(metadataJson: string): boolean {
	const metadata = parseMetadata(metadataJson);
	return (
		metadata.placeholderName === true && typeof metadata.renamedAt !== 'string'
	);
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
