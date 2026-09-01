import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type {
	ArchivedWorkspaceSnapshot,
	ArchiveWorkspaceDiagnostic,
	ArchiveWorkspaceDiagnosticCode,
	ArchiveWorkspaceRequest,
	ArchiveWorkspaceResult,
} from '../../shared/ipc/contracts/workspace';
import type { LocalCommandService } from '../commands/local-command';
import type { EnsemblrRootDirectoryService } from '../root';
import type { EnsemblrDatabaseService } from '../storage';
import { updateArchiveRecordPruneState } from '../storage/repositories/archive-record-repository.ts';
import {
	selectWorkspaceWithRepositoryById,
	stampWorkspaceArchived,
} from '../storage/repositories/workspace-repository.ts';
import { withTransaction } from '../storage/tx.ts';
import {
	failureResult,
	pushLifecycleDiagnostics,
} from './archive-diagnostics.ts';
import type { ArchiveLifecycleService } from './archive-lifecycle.ts';
import { toLifecycleTargets } from './archive-lifecycle-targets.ts';
import { insertArchiveRecord } from './archive-records.ts';
import { readContinuedBranches } from './continued-branches.ts';
import { copyDirectoryTree } from './copy-directory.ts';
import { runBranchDelete, runWorktreeRemove } from './git-ops.ts';
import { pruneWorktree } from './prune-worktree.ts';
import { hasWorkspaceRepositoryIdentity, isRecord } from './row-guards.ts';
import type { WorkspaceTeardownService } from './workspace-teardown.ts';

/** Public surface of the workspace lifecycle archive service. */
export interface ArchiveWorkspaceService {
	archive: (
		request: ArchiveWorkspaceRequest,
	) => Promise<ArchiveWorkspaceResult>;
}

/** Options for {@link createArchiveWorkspaceService}. */
export interface CreateArchiveWorkspaceServiceOptions {
	archiveLifecycleService: ArchiveLifecycleService;
	databaseService: EnsemblrDatabaseService;
	localCommandService: LocalCommandService;
	now?: () => Date;
	rootDirectoryService: EnsemblrRootDirectoryService;
	workspaceTeardownService: WorkspaceTeardownService;
}

/** Workspace + repository fields the lifecycle archive needs in one read. */
interface SourceWorkspace {
	archivedAt: string | null;
	baseBranch: string | null;
	branchName: string | null;
	id: string;
	metadataJson: string;
	name: string;
	path: string;
	repositoryId: string;
	repositoryName: string;
	repositoryPath: string;
	repositorySlug: string;
	slug: string;
}

const CONTEXT_DIRECTORY = '.context';
const ARCHIVE_METADATA_FILENAME = 'archive-metadata.json';

/**
 * Builds the service that archives a workspace as a lifecycle state. Sets
 * `workspaces.archived_at`, preserves the workspace `.context/` under
 * `<root>/archived-contexts/<repo-slug>/<workspace-slug>-<timestamp>/`, writes
 * an `archive-metadata.json` snapshot, and inserts a row into `archive_records`
 * so ENS-038 / ENS-060 subscribers have enough state to act on later.
 *
 * What happens to the worktree is the request's choice. `reclaimDisk` removes
 * the directory and keeps the branch, so the workspace is re-derived from git
 * on unarchive; `branchCleanup` removes the directory and drops the branch,
 * which is not reversible. Neither runs unless the request opts in.
 */
export function createArchiveWorkspaceService({
	archiveLifecycleService,
	databaseService,
	localCommandService,
	now = () => new Date(),
	rootDirectoryService,
	workspaceTeardownService,
}: CreateArchiveWorkspaceServiceOptions): ArchiveWorkspaceService {
	return {
		archive: async (request) => {
			const target = resolveArchiveTarget({
				databaseService,
				request,
				rootDirectoryService,
			});
			if ('diagnostic' in target) {
				return failure(target.diagnostic);
			}
			const { archivedContextsRoot, database, source } = target;

			const branchCleanup = request.branchCleanup === true;
			// Deleting the branch already removes the worktree, and it deliberately
			// destroys the commits with it — so it takes the discard path below
			// rather than the prune path, which exists to keep them recoverable.
			const reclaimDisk = !branchCleanup && request.reclaimDisk === true;
			const reason =
				typeof request.reason === 'string' && request.reason.trim()
					? request.reason.trim()
					: null;
			const archivedAt = now().toISOString();
			const diagnostics: ArchiveWorkspaceDiagnostic[] = [];

			const preserved = await preserveContextDirectory({
				archivedAt,
				archivedContextsRoot,
				diagnostics,
				source,
			});

			const preHookOutcome = await archiveLifecycleService.invoke(
				'pre-archive-workspace',
				{
					archivedAt,
					archivedContextPath: preserved.archivedContextPath,
					branchCleanup,
					...toLifecycleTargets(source),
				},
			);
			pushLifecycleDiagnostics(diagnostics, preHookOutcome.diagnostics);

			if (preHookOutcome.aborted) {
				return {
					archiveRecordId: null,
					diagnostics: [
						...diagnostics,
						{
							code: 'archive-aborted-by-hook',
							message: preHookOutcome.aborted.message,
							severity: 'error',
						},
					],
					status: 'aborted',
					workspace: null,
				};
			}

			// An archived workspace leaves the navigation, so anything still running
			// in it becomes an orphan the user can no longer see or stop. Detached
			// only once the archive is certain to proceed: a hook that vetoes it
			// must not cost the user their terminals and agent turns.
			const teardown = await workspaceTeardownService.teardown({
				workspaceId: source.id,
				workspacePath: source.path,
			});
			for (const message of teardown.failures) {
				diagnostics.push({
					code: 'workspace-update-failed',
					message,
					severity: 'warning',
				});
			}

			const recordId = `archive-${randomUUID()}`;

			// Stamp the database before touching the filesystem so a crash in
			// the destructive git steps below leaves the workspace correctly
			// flagged as archived (with warnings) rather than live + worktreeless.
			try {
				stampArchivedAt({
					archivedAt,
					database,
					recordId,
					reason,
					source,
					archivedContextPath: preserved.archivedContextPath,
					branchCleanup,
				});
			} catch (error) {
				diagnostics.push({
					code: 'workspace-update-failed',
					message:
						error instanceof Error
							? error.message
							: 'Failed to record the archive lifecycle row.',
					severity: 'error',
				});
				return {
					archiveRecordId: null,
					diagnostics,
					status: 'failure',
					workspace: null,
				};
			}

			let branchDeleted = false;
			if (branchCleanup && source.branchName) {
				// Worktree first so `git branch -D` can drop the now-unchecked-out
				// branch. .context/ files were already copied into
				// archived-contexts/ above, so losing the worktree directory does
				// not lose any handoff state.
				const worktreeOutcome = await runWorktreeRemove({
					localCommandService,
					repositoryPath: source.repositoryPath,
					workspacePath: source.path,
				});
				if (worktreeOutcome.status === 'failure') {
					diagnostics.push({
						code: 'branch-cleanup-failed',
						message: worktreeOutcome.message,
						path: source.path,
						severity: 'warning',
					});
				}

				branchDeleted = await deleteBranchChain({
					branchName: source.branchName,
					diagnostics,
					localCommandService,
					predecessors: readContinuedBranches(source.metadataJson),
					repositoryPath: source.repositoryPath,
				});
			}

			const reclaimed = reclaimDisk
				? await reclaimWorktreeDisk({
						archivedContextPath: preserved.archivedContextPath,
						database,
						diagnostics,
						localCommandService,
						recordId,
						source,
					})
				: { bytesFreed: null, worktreePruned: false };

			if (preserved.archivedContextPath) {
				writeArchiveMetadata({
					archiveRecordId: recordId,
					archivedAt,
					branchCleanup,
					branchDeleted,
					diagnostics,
					preservedDirectory: preserved.archivedContextPath,
					reason,
					source,
					worktreePruned: reclaimed.worktreePruned,
				});
			}

			const postHookOutcome = await archiveLifecycleService.invoke(
				'post-archive-workspace',
				{
					archivedAt,
					archivedContextPath: preserved.archivedContextPath,
					branchCleanup,
					...toLifecycleTargets(source),
				},
			);
			pushLifecycleDiagnostics(diagnostics, postHookOutcome.diagnostics);

			const workspace: ArchivedWorkspaceSnapshot = {
				archivedAt,
				archivedContextPath: preserved.archivedContextPath,
				branchCleanup,
				branchDeleted,
				branchName: source.branchName,
				bytesFreed: reclaimed.bytesFreed,
				id: source.id,
				name: source.name,
				path: source.path,
				repositoryId: source.repositoryId,
				slug: source.slug,
				worktreePruned: reclaimed.worktreePruned,
			};

			return {
				archiveRecordId: recordId,
				diagnostics,
				status: 'success',
				workspace,
			};
		},
	};
}

/** Everything an archive needs before it can touch anything, or why it cannot. */
type ArchiveTarget =
	| {
			archivedContextsRoot: string;
			database: DatabaseSync;
			source: SourceWorkspace;
	  }
	| { diagnostic: ArchiveWorkspaceDiagnostic };

/**
 * Resolves the workspace an archive will act on, refusing up front anything the
 * lifecycle cannot proceed without: an open database, a usable id, a workspace
 * that exists and is not already archived, and a managed root to preserve its
 * context under.
 * @param options - Service dependencies and the incoming request.
 * @returns The resolved target, or the diagnostic that blocks the archive.
 */
function resolveArchiveTarget({
	databaseService,
	request,
	rootDirectoryService,
}: {
	databaseService: EnsemblrDatabaseService;
	request: ArchiveWorkspaceRequest;
	rootDirectoryService: EnsemblrRootDirectoryService;
}): ArchiveTarget {
	const database = databaseService.getConnection()?.database;
	if (!database) {
		return {
			diagnostic: {
				code: 'database-unavailable',
				message: 'SQLite is unavailable; the workspace was not archived.',
				severity: 'error',
			},
		};
	}

	const workspaceId =
		typeof request.workspaceId === 'string' ? request.workspaceId.trim() : '';
	if (!workspaceId) {
		return {
			diagnostic: {
				code: 'workspace-id-required',
				message: 'A workspace id is required to archive a workspace.',
				severity: 'error',
			},
		};
	}

	const source = readWorkspace(database, workspaceId);
	if (!source) {
		return {
			diagnostic: {
				code: 'workspace-not-found',
				message: `No workspace is registered with id ${workspaceId}.`,
				severity: 'error',
			},
		};
	}

	if (source.archivedAt) {
		return {
			diagnostic: {
				code: 'workspace-already-archived',
				message: `Workspace "${source.name}" was already archived at ${source.archivedAt}.`,
				severity: 'info',
			},
		};
	}

	const rootSnapshot =
		rootDirectoryService.getSnapshot() ?? rootDirectoryService.ensure();
	if (!rootSnapshot.archivedContextsPath) {
		return {
			diagnostic: {
				code: 'archived-contexts-directory-missing',
				message:
					'The managed root has no archived-contexts path; configure the root directory first.',
				severity: 'error',
			},
		};
	}

	return {
		archivedContextsRoot: rootSnapshot.archivedContextsPath,
		database,
		source,
	};
}

/**
 * Reads a workspace together with its repository to seed an archive operation.
 * @param database - Open database handle
 * @param workspaceId - Workspace to read
 * @returns The source workspace, or null when not found
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

/**
 * Deletes the workspace's branch along with every branch it continued off, so a
 * workspace that moved through `feature`, `feature-v1`, `feature-v2` does not
 * leave the first two behind. A missing predecessor is expected — the user may
 * have pruned it already — and only real failures raise a diagnostic.
 * @param branchName - The branch the workspace ended on.
 * @param diagnostics - Collector the archive result reports through.
 * @param localCommandService - Command runner used for git.
 * @param predecessors - Branches recorded in the continuation chain.
 * @param repositoryPath - Repository the branches live in.
 * @returns True when the workspace's own branch was deleted.
 */
async function deleteBranchChain({
	branchName,
	diagnostics,
	localCommandService,
	predecessors,
	repositoryPath,
}: {
	branchName: string;
	diagnostics: ArchiveWorkspaceDiagnostic[];
	localCommandService: LocalCommandService;
	predecessors: readonly string[];
	repositoryPath: string;
}): Promise<boolean> {
	let branchDeleted = false;
	for (const candidate of [branchName, ...predecessors]) {
		// Deletions stay sequential: concurrent `git branch -D` runs in one repo
		// contend on packed-refs.lock and fail rather than wait.
		// oxlint-disable-next-line react-doctor/async-await-in-loop
		const outcome = await runBranchDelete({
			branchName: candidate,
			localCommandService,
			repositoryPath,
		});
		if (outcome.status === 'success' && candidate === branchName) {
			branchDeleted = true;
		}
		if (outcome.status === 'failure') {
			diagnostics.push({
				code: 'branch-cleanup-failed',
				message: outcome.message,
				severity: 'warning',
			});
		}
	}
	return branchDeleted;
}

/**
 * Removes the worktree directory while keeping the branch, and records what a
 * later unarchive needs to re-derive it.
 *
 * A worktree is overwhelmingly gitignored dependencies and build output that
 * the setup script rebuilds, so keeping it is a permanent disk cost for state
 * nobody reads. A prune that fails is a warning rather than an error: the
 * archive itself succeeded and the only consequence is disk still in use.
 * @param options - Preserved context path, database, diagnostics sink, git
 * dependencies, archive record id, and the workspace being archived.
 * @returns Whether the worktree was pruned, and how much disk that reclaimed.
 */
async function reclaimWorktreeDisk({
	archivedContextPath,
	database,
	diagnostics,
	localCommandService,
	recordId,
	source,
}: {
	archivedContextPath: string | null;
	database: DatabaseSync;
	diagnostics: ArchiveWorkspaceDiagnostic[];
	localCommandService: LocalCommandService;
	recordId: string;
	source: SourceWorkspace;
}): Promise<{ bytesFreed: number | null; worktreePruned: boolean }> {
	const pruned = await pruneWorktree({
		archivedContextPath,
		branchName: source.branchName,
		localCommandService,
		repositoryPath: source.repositoryPath,
		workspaceId: source.id,
		workspacePath: source.path,
	});

	if (pruned.status === 'failure') {
		diagnostics.push({
			code: 'worktree-prune-failed',
			message: pruned.message ?? 'The worktree could not be removed.',
			path: source.path,
			severity: 'warning',
		});
		return { bytesFreed: null, worktreePruned: false };
	}

	if (pruned.status === 'skipped') {
		return { bytesFreed: null, worktreePruned: false };
	}

	try {
		updateArchiveRecordPruneState({
			database,
			prunedHeadCommit: pruned.headCommit,
			prunedWipCommit: pruned.wipCommit,
			prunedWipRef: pruned.wipRef,
			recordId,
		});
	} catch (error) {
		diagnostics.push({
			code: 'workspace-update-failed',
			message:
				error instanceof Error
					? error.message
					: 'Failed to record the prune state; unarchive will not find the worktree.',
			severity: 'error',
		});
		return { bytesFreed: pruned.bytesFreed, worktreePruned: false };
	}

	return { bytesFreed: pruned.bytesFreed, worktreePruned: true };
}

/**
 * Copies the workspace `.context/` directory (when present) into
 * `<archived-contexts>/<repo-slug>/<workspace-slug>-<timestamp>/.context/`.
 * Records a diagnostic when the copy fails; returns `archivedContextPath: null`
 * so the lifecycle continues even if the user already wiped the directory.
 */
async function preserveContextDirectory({
	archivedAt,
	archivedContextsRoot,
	diagnostics,
	source,
}: {
	archivedAt: string;
	archivedContextsRoot: string;
	diagnostics: ArchiveWorkspaceDiagnostic[];
	source: SourceWorkspace;
}): Promise<{ archivedContextPath: string | null }> {
	const directoryName = `${source.slug}-${toFilesystemTimestamp(archivedAt)}`;
	const archivedContextPath = path.join(
		archivedContextsRoot,
		source.repositorySlug,
		directoryName,
	);

	if (existsSync(archivedContextPath)) {
		diagnostics.push({
			code: 'archived-context-already-exists',
			message: `Archived context destination already exists: ${archivedContextPath}.`,
			path: archivedContextPath,
			severity: 'warning',
		});
		return { archivedContextPath: null };
	}

	try {
		await mkdir(archivedContextPath, { recursive: true });
	} catch (error) {
		diagnostics.push({
			code: 'archived-context-copy-failed',
			message:
				error instanceof Error
					? error.message
					: 'Failed to create the archived-context destination.',
			path: archivedContextPath,
			severity: 'warning',
		});
		return { archivedContextPath: null };
	}

	const sourceContextDir = path.join(source.path, CONTEXT_DIRECTORY);
	if (!existsSync(sourceContextDir)) {
		// No handoff context to preserve; the archive-metadata.json alone is
		// enough provenance for the lifecycle record.
		return { archivedContextPath };
	}

	// The terminals writing into this tree are torn down after the archive is
	// certain to proceed, which is after this copy — so the retries inside
	// `copyDirectoryTree` are what stop a scrollback flush rotating a file
	// mid-walk from costing the user the whole preserved context.
	const copied = await copyDirectoryTree(
		sourceContextDir,
		path.join(archivedContextPath, CONTEXT_DIRECTORY),
	);

	if (copied.error !== null) {
		diagnostics.push({
			code: 'archived-context-copy-failed',
			message: copied.error,
			path: sourceContextDir,
			severity: 'warning',
		});
	}

	return { archivedContextPath };
}

/**
 * Stamps `archived_at` on the workspace and inserts a workspace-level archive
 * record within a single transaction.
 */
function stampArchivedAt({
	archivedAt,
	archivedContextPath,
	branchCleanup,
	database,
	reason,
	recordId,
	source,
}: {
	archivedAt: string;
	archivedContextPath: string | null;
	branchCleanup: boolean;
	database: DatabaseSync;
	reason: string | null;
	recordId: string;
	source: SourceWorkspace;
}): void {
	withTransaction(database, () => {
		stampWorkspaceArchived({ archivedAt, database, id: source.id });
		insertArchiveRecord({
			archivedAt,
			archivedContextPath,
			baseBranch: source.baseBranch,
			branchCleanup,
			branchName: source.branchName,
			database,
			kind: 'workspace',
			reason,
			recordId,
			repositoryId: source.repositoryId,
			repositoryPath: source.repositoryPath,
			repositorySlug: source.repositorySlug,
			workspaceId: source.id,
			workspacePath: source.path,
			workspaceSlug: source.slug,
		});
	});
}

/**
 * Writes an `archive-record/v1` metadata JSON into the preserved `.context`
 * directory, recording a diagnostic when the write fails.
 */
function writeArchiveMetadata({
	archiveRecordId,
	archivedAt,
	branchCleanup,
	branchDeleted,
	diagnostics,
	preservedDirectory,
	reason,
	source,
	worktreePruned,
}: {
	archiveRecordId: string;
	archivedAt: string;
	branchCleanup: boolean;
	branchDeleted: boolean;
	diagnostics: ArchiveWorkspaceDiagnostic[];
	preservedDirectory: string;
	reason: string | null;
	source: SourceWorkspace;
	worktreePruned: boolean;
}): void {
	const payload = {
		archiveRecordId,
		archivedAt,
		branchCleanup,
		branchDeleted,
		ensemblrSchema: 'archive-record/v1',
		worktreePruned,
		reason,
		repository: {
			id: source.repositoryId,
			name: source.repositoryName,
			path: source.repositoryPath,
			slug: source.repositorySlug,
		},
		workspace: {
			baseBranch: source.baseBranch,
			branchName: source.branchName,
			id: source.id,
			name: source.name,
			path: source.path,
			slug: source.slug,
		},
	};

	try {
		writeFileSync(
			path.join(preservedDirectory, ARCHIVE_METADATA_FILENAME),
			`${JSON.stringify(payload, null, 2)}\n`,
			'utf8',
		);
	} catch (error) {
		diagnostics.push({
			code: 'archived-context-copy-failed',
			message:
				error instanceof Error
					? error.message
					: 'Failed to write archive-metadata.json into the archived-contexts directory.',
			path: preservedDirectory,
			severity: 'warning',
		});
	}
}

/** Renders an ISO timestamp into a filesystem-safe suffix. */
function toFilesystemTimestamp(isoTimestamp: string): string {
	return isoTimestamp.replace(/[:.]/g, '-');
}

/**
 * Wraps an archive diagnostic in a failed {@link ArchiveWorkspaceResult}.
 * @param diagnostic - Diagnostic describing the failure
 * @returns The failure result
 */
function failure(
	diagnostic: ArchiveWorkspaceDiagnostic,
): ArchiveWorkspaceResult {
	return failureResult(diagnostic, {
		archiveRecordId: null,
		workspace: null,
	});
}

/**
 * Type guard for a raw workspace row joined with its repository identity.
 * @param row - Candidate database row
 * @returns True when the row matches {@link SourceWorkspace}
 */
function isWorkspaceRow(row: unknown): row is SourceWorkspace {
	if (!isRecord(row)) {
		return false;
	}
	return (
		hasWorkspaceRepositoryIdentity(row) &&
		(row.baseBranch === null || typeof row.baseBranch === 'string') &&
		typeof row.metadataJson === 'string'
	);
}

export type { ArchiveWorkspaceDiagnosticCode };
