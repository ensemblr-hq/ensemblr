import type { DatabaseSync } from 'node:sqlite';

import type {
	ContinueWorkspaceBranchDiagnostic,
	ContinueWorkspaceBranchRequest,
	ContinueWorkspaceBranchResult,
} from '../../shared/ipc/contracts/workspace';
import type { LocalCommandService } from '../commands/local-command';
import { deleteCachedPullRequestSnapshot } from '../github/pr-cache.ts';
import type { EnsemblrDatabaseService } from '../storage';
import {
	selectWorkspaceWithRepositoryById,
	updateWorkspaceBranchRow,
} from '../storage/repositories/workspace-repository.ts';
import { withTransaction } from '../storage/tx.ts';
import {
	branchNameFromRef,
	nextContinuationBranchName,
} from './branch-name.ts';
import { appendContinuedBranch } from './continued-branches.ts';
import { ensureBaseRefAvailable } from './create-workspace.ts';
import { firstLine } from './first-line.ts';

/** Public surface of the continue-workspace-branch service. */
export interface ContinueWorkspaceBranchService {
	continueBranch: (
		request: ContinueWorkspaceBranchRequest,
	) => Promise<ContinueWorkspaceBranchResult>;
}

/** Options for {@link createContinueWorkspaceBranchService}. */
export interface CreateContinueWorkspaceBranchServiceOptions {
	databaseService: EnsemblrDatabaseService;
	localCommandService: LocalCommandService;
	now?: () => Date;
}

/** Internal: the workspace row fields this service reads. */
interface SourceWorkspace {
	baseBranch: string | null;
	branchName: string | null;
	id: string;
	metadataJson: string;
	path: string;
	repositoryPath: string;
}

/**
 * Where the worktree sat before the switch: the branch the successor name is
 * derived from, and the ref to check out again if the move has to be undone.
 * They differ on a detached HEAD, where the name falls back to SQLite but only
 * the commit restores the exact prior position.
 */
interface WorktreePosition {
	continuationBase: string;
	restoreTarget: string;
}

/** Where the successor branch forks from, and whether that dropped merged work. */
interface ContinuationStartPoint {
	commit: string | null;
	unsyncedReason: string | null;
}

const GIT_TIMEOUT_MS = 15_000;
const GIT_MAX_OUTPUT_BYTES = 256 * 1024;
const DETACHED_HEAD_LABEL = 'HEAD';

/**
 * Builds the service that moves a workspace off its merged pull request and
 * onto a fresh successor branch.
 *
 * The successor forks from the base branch when the workspace's committed tree
 * already matches it — the normal shape once a pull request has merged — so the
 * review panel opens empty instead of re-listing work that is already upstream.
 * A squash or rebase merge rewrites history, so the merged commits are never
 * ancestors of the base and a plain fork from HEAD would show the whole merged
 * diff again. When the trees differ the branch still holds commits the base has
 * not taken, so the fork falls back to HEAD and the result carries a
 * `base-branch-unsynced` warning rather than dropping those commits.
 *
 * The merged branch itself is left in place — the old pull request keeps the ref
 * it was merged from, and archive cleans the whole chain up later. Uncommitted
 * edits carry over untouched. Dropping the cached PR snapshot is what makes the
 * review sidebar stop showing the merged PR before the next `gh` sweep lands.
 * @param options - Service dependencies.
 * @returns A {@link ContinueWorkspaceBranchService}.
 */
export function createContinueWorkspaceBranchService({
	databaseService,
	localCommandService,
	now = () => new Date(),
}: CreateContinueWorkspaceBranchServiceOptions): ContinueWorkspaceBranchService {
	/**
	 * Runs a git command inside the workspace worktree.
	 * @param cwd - Directory to run in.
	 * @param args - Arguments passed to `git`.
	 * @returns The command result.
	 */
	async function runGit(cwd: string, args: readonly string[]) {
		return localCommandService.run({
			args: [...args],
			command: 'git',
			cwd,
			maxOutputBytes: GIT_MAX_OUTPUT_BYTES,
			timeoutMs: GIT_TIMEOUT_MS,
		});
	}

	/**
	 * Reads a single-line git value, returning `null` when the command fails or
	 * prints nothing.
	 * @param cwd - Directory to run in.
	 * @param args - Arguments passed to `git`.
	 * @returns The trimmed first line, or `null`.
	 */
	async function readGitValue(
		cwd: string,
		args: readonly string[],
	): Promise<string | null> {
		const result = await runGit(cwd, args);
		if (result.status !== 'success') {
			return null;
		}
		return result.stdout.trim() || null;
	}

	/**
	 * Locates the worktree's current position, falling back to the branch
	 * recorded in SQLite for the successor name when HEAD is detached or git
	 * cannot be reached.
	 * @param source - Workspace being continued.
	 * @returns The prior position, or `null` when no branch name can be resolved.
	 */
	async function resolveWorktreePosition(
		source: SourceWorkspace,
	): Promise<WorktreePosition | null> {
		const head = await readGitValue(source.path, [
			'rev-parse',
			'--abbrev-ref',
			'HEAD',
		]);
		if (head && head !== DETACHED_HEAD_LABEL) {
			return { continuationBase: head, restoreTarget: head };
		}
		const headCommit = await readGitValue(source.path, ['rev-parse', 'HEAD']);
		if (!source.branchName) {
			return null;
		}
		return {
			continuationBase: source.branchName,
			restoreTarget: headCommit ?? source.branchName,
		};
	}

	/**
	 * Lists every branch name a successor could collide with, local and
	 * remote-tracking alike, so a name that survives only as `origin/<name>` is
	 * not handed out again.
	 * @param cwd - Directory to run in.
	 * @returns The claimed branch names.
	 */
	async function listClaimedBranchNames(cwd: string): Promise<string[]> {
		const result = await runGit(cwd, [
			'for-each-ref',
			'--format=%(refname)',
			'refs/heads',
			'refs/remotes',
		]);
		if (result.status !== 'success') {
			return [];
		}
		return result.stdout
			.split('\n')
			.map((line) => branchNameFromRef(line))
			.filter((name): name is string => name !== null);
	}

	/**
	 * Picks the commit the successor forks from: the base branch when the
	 * workspace's committed tree already matches it, otherwise HEAD with the
	 * reason the sync was skipped.
	 * @param source - Workspace being continued.
	 * @returns The fork point and any unsynced reason.
	 */
	async function resolveStartPoint(
		source: SourceWorkspace,
	): Promise<ContinuationStartPoint> {
		const baseBranch = source.baseBranch?.trim();
		if (!baseBranch) {
			return { commit: null, unsyncedReason: null };
		}

		await ensureBaseRefAvailable({
			baseBranch,
			localCommandService,
			repositoryPath: source.repositoryPath,
		});
		const baseCommit = await readGitValue(source.path, [
			'rev-parse',
			'--verify',
			'--quiet',
			`${baseBranch}^{commit}`,
		]);
		if (!baseCommit) {
			return {
				commit: null,
				unsyncedReason: `Could not resolve "${baseBranch}", so the new branch forked from the previous one and still contains its commits.`,
			};
		}

		const identicalTrees = await runGit(source.path, [
			'diff',
			'--quiet',
			baseCommit,
			'HEAD',
		]);
		if (identicalTrees.status !== 'success') {
			return {
				commit: null,
				unsyncedReason: `This branch holds commits that "${baseBranch}" does not, so the new branch kept them and its diff will include already-merged work.`,
			};
		}
		return { commit: baseCommit, unsyncedReason: null };
	}

	/**
	 * Puts the worktree back where it started and drops the half-created branch.
	 * @param nextBranch - Successor branch to remove.
	 * @param position - Position captured before the switch.
	 * @param source - Workspace being continued.
	 * @returns A warning diagnostic when the worktree could not be restored.
	 */
	async function restoreWorktree({
		nextBranch,
		position,
		source,
	}: {
		nextBranch: string;
		position: WorktreePosition;
		source: SourceWorkspace;
	}): Promise<ContinueWorkspaceBranchDiagnostic | null> {
		const checkout = await runGit(source.path, [
			'checkout',
			position.restoreTarget,
		]);
		if (checkout.status !== 'success') {
			return {
				code: 'branch-rollback-failed',
				message: `The worktree is still on "${nextBranch}" — restoring "${position.restoreTarget}" failed: ${firstLine(checkout.stderr) || 'git checkout failed.'}`,
				severity: 'warning',
			};
		}
		const remove = await runGit(source.path, ['branch', '-D', nextBranch]);
		if (remove.status !== 'success') {
			return {
				code: 'branch-rollback-failed',
				message: `The worktree was restored to "${position.restoreTarget}", but the unused branch "${nextBranch}" could not be deleted.`,
				severity: 'warning',
			};
		}
		return null;
	}

	/**
	 * Creates the successor branch, checks it out, and records the move. Rolls
	 * the worktree back when the SQLite write fails, reporting a warning when
	 * that rollback cannot complete rather than leaving the mismatch unsaid.
	 * @param position - Position captured before the switch.
	 * @param database - Open SQLite connection.
	 * @param source - Workspace being continued.
	 * @returns The continue result.
	 */
	async function switchToContinuationBranch({
		database,
		position,
		source,
	}: {
		database: DatabaseSync;
		position: WorktreePosition;
		source: SourceWorkspace;
	}): Promise<ContinueWorkspaceBranchResult> {
		const nextBranch = nextContinuationBranchName(
			position.continuationBase,
			await listClaimedBranchNames(source.path),
		);
		const startPoint = await resolveStartPoint(source);
		const checkout = await runGit(source.path, [
			'checkout',
			'-b',
			nextBranch,
			...(startPoint.commit ? [startPoint.commit] : []),
		]);
		if (checkout.status !== 'success') {
			return failure(source.id, {
				code: 'branch-checkout-failed',
				message:
					firstLine(checkout.stderr) ||
					`Could not create branch "${nextBranch}".`,
				severity: 'error',
			});
		}

		try {
			commitBranchSwitch({
				branchName: nextBranch,
				database,
				metadataJson: appendContinuedBranch(
					source.metadataJson,
					position.continuationBase,
				),
				timestamp: now().toISOString(),
				workspaceId: source.id,
			});
		} catch (error) {
			const rollback = await restoreWorktree({
				nextBranch,
				position,
				source,
			});
			return failure(
				source.id,
				{
					code: 'workspace-update-failed',
					message:
						error instanceof Error
							? error.message
							: 'Failed to record the new branch in SQLite.',
					severity: 'error',
				},
				...(rollback ? [rollback] : []),
			);
		}

		return {
			branchName: nextBranch,
			diagnostics: startPoint.unsyncedReason
				? [
						{
							code: 'base-branch-unsynced',
							message: startPoint.unsyncedReason,
							severity: 'warning',
						},
					]
				: [],
			previousBranchName: position.continuationBase,
			status: 'success',
			workspaceId: source.id,
		};
	}

	return {
		continueBranch: async (request) => {
			const database = databaseService.getConnection()?.database;
			if (!database) {
				return failure(request.workspaceId, {
					code: 'database-unavailable',
					message: 'SQLite is unavailable; the workspace was not continued.',
					severity: 'error',
				});
			}

			const workspaceId = request.workspaceId.trim();
			const source = readWorkspace(database, workspaceId);
			if (!source) {
				return failure(workspaceId, {
					code: 'workspace-not-found',
					message: `No workspace is registered with id ${workspaceId || '(missing)'}.`,
					severity: 'error',
				});
			}

			const position = await resolveWorktreePosition(source);
			if (!position) {
				return failure(workspaceId, {
					code: 'branch-unresolved',
					message:
						'Could not determine which branch this workspace is on, so no successor branch was created.',
					severity: 'error',
				});
			}

			return switchToContinuationBranch({ database, position, source });
		},
	};
}

/**
 * Loads the workspace row, or `null` when the id resolves to nothing.
 * @param database - Open SQLite connection.
 * @param workspaceId - Workspace to read.
 * @returns The workspace fields this service needs, or `null`.
 */
function readWorkspace(
	database: DatabaseSync,
	workspaceId: string,
): SourceWorkspace | null {
	if (!workspaceId) {
		return null;
	}
	const row = selectWorkspaceWithRepositoryById({ database, workspaceId }) as
		| Record<string, unknown>
		| undefined;
	if (
		typeof row?.id !== 'string' ||
		typeof row.path !== 'string' ||
		typeof row.repositoryPath !== 'string'
	) {
		return null;
	}
	return {
		baseBranch: typeof row.baseBranch === 'string' ? row.baseBranch : null,
		branchName: typeof row.branchName === 'string' ? row.branchName : null,
		id: row.id,
		metadataJson:
			typeof row.metadataJson === 'string' ? row.metadataJson : '{}',
		path: row.path,
		repositoryPath: row.repositoryPath,
	};
}

/**
 * Records the new branch, its predecessor chain, and drops the stale PR
 * snapshot in one transaction, so the workspace never ends up pointing at the
 * new branch while still serving the merged pull request from cache.
 * @param branchName - Successor branch now checked out.
 * @param database - Open SQLite connection.
 * @param metadataJson - Metadata carrying the updated continuation chain.
 * @param timestamp - ISO timestamp for the row update.
 * @param workspaceId - Workspace being continued.
 */
function commitBranchSwitch({
	branchName,
	database,
	metadataJson,
	timestamp,
	workspaceId,
}: {
	branchName: string;
	database: DatabaseSync;
	metadataJson: string;
	timestamp: string;
	workspaceId: string;
}): void {
	withTransaction(database, () => {
		updateWorkspaceBranchRow({
			branchName,
			database,
			id: workspaceId,
			metadataJson,
			timestamp,
		});
		deleteCachedPullRequestSnapshot({ database, workspaceId });
	});
}

/**
 * Builds the standard failure shape for any rejected continue request.
 * @param workspaceId - Workspace the request targeted.
 * @param diagnostics - Why it failed, most significant first.
 * @returns The failure result.
 */
function failure(
	workspaceId: string,
	...diagnostics: ContinueWorkspaceBranchDiagnostic[]
): ContinueWorkspaceBranchResult {
	return {
		branchName: null,
		diagnostics,
		previousBranchName: null,
		status: 'failure',
		workspaceId,
	};
}
