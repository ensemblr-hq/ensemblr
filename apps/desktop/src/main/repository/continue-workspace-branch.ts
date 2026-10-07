import type { DatabaseSync } from 'node:sqlite';

import type {
	ContinueWorkspaceBranchDiagnostic,
	ContinueWorkspaceBranchRequest,
	ContinueWorkspaceBranchResult,
} from '../../shared/ipc/contracts/workspace';
import type { LocalCommandService } from '../commands/local-command';
import {
	deleteCachedPullRequestSnapshot,
	readCachedPullRequestSnapshot,
} from '../github/pr-cache.ts';
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
import {
	type ContinuationPlan,
	createWorktreeGit,
	planContinuation,
	type WorktreeGit,
} from './continuation-plan.ts';
import { appendContinuedBranch } from './continued-branches.ts';
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

/** Whether the successor branch is checked out, and what to report about it. */
interface SuccessorPlacement {
	diagnostics: ContinueWorkspaceBranchDiagnostic[];
	status: 'failure' | 'success';
}

/** A plan that leads to a checkout, as opposed to a refusal. */
type PlacementPlan = Exclude<ContinuationPlan, { kind: 'blocked' }>;

const DETACHED_HEAD_LABEL = 'HEAD';

/**
 * Replaying runs `git cherry-pick`, which commits — and so may sign or run
 * hooks — once per follow-up commit; it gets longer than a plain git call.
 */
const REPLAY_TIMEOUT_MS = 60_000;

/**
 * Builds the service that moves a workspace off its merged pull request and
 * onto a fresh successor branch.
 *
 * {@link planContinuation} fetches the base and decides the fork point. When
 * the work HEAD committed is already upstream — however it merged, squash
 * included — the successor forks from the freshly fetched base, so the review
 * panel opens empty and the next pull request starts from the latest code.
 * Commits made after the pull request's merged head, which it reads from the
 * cached PR snapshot, are cherry-picked on top; a replay that conflicts is
 * aborted and the successor forks from HEAD instead, so the worktree is never
 * left mid-conflict. Uncommitted edits to a file the switch would rewrite
 * refuse the move outright.
 *
 * The merged branch itself is left in place — the old pull request keeps the ref
 * it was merged from, and archive cleans the whole chain up later. Other
 * uncommitted edits carry over untouched. Dropping the cached PR snapshot is
 * what makes the review sidebar stop showing the merged PR before the next `gh`
 * sweep lands.
 * @param options - Service dependencies.
 * @returns A {@link ContinueWorkspaceBranchService}.
 */
export function createContinueWorkspaceBranchService({
	databaseService,
	localCommandService,
	now = () => new Date(),
}: CreateContinueWorkspaceBranchServiceOptions): ContinueWorkspaceBranchService {
	/**
	 * Plans the successor branch, checks it out, and records the move. Rolls
	 * the worktree back when the SQLite write fails, reporting a warning when
	 * that rollback cannot complete rather than leaving the mismatch unsaid.
	 * @param position - Position captured before the switch.
	 * @param database - Open SQLite connection.
	 * @param git - Git bound to the workspace worktree.
	 * @param source - Workspace being continued.
	 * @returns The continue result.
	 */
	async function switchToContinuationBranch({
		database,
		git,
		position,
		source,
	}: {
		database: DatabaseSync;
		git: WorktreeGit;
		position: WorktreePosition;
		source: SourceWorkspace;
	}): Promise<ContinueWorkspaceBranchResult> {
		const nextBranch = nextContinuationBranchName(
			position.continuationBase,
			await listClaimedBranchNames(git),
		);
		const plan = await planContinuation({
			baseBranch: source.baseBranch,
			git,
			localCommandService,
			mergedHeadCommit: readMergedHeadCommit(database, source.id),
			repositoryPath: source.repositoryPath,
		});
		if (plan.kind === 'blocked') {
			return failure(source.id, plan.diagnostic);
		}

		const placement = await placeSuccessor({
			baseBranch: source.baseBranch ?? '',
			git,
			nextBranch,
			plan,
			position,
		});
		if (placement.status === 'failure') {
			return failure(source.id, ...placement.diagnostics);
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
			const rollback = await restoreWorktree({ git, nextBranch, position });
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
			diagnostics: placement.diagnostics,
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

			const git = createWorktreeGit(localCommandService, source.path);
			const position = await resolveWorktreePosition(git, source);
			if (!position) {
				return failure(workspaceId, {
					code: 'branch-unresolved',
					message:
						'Could not determine which branch this workspace is on, so no successor branch was created.',
					severity: 'error',
				});
			}

			return switchToContinuationBranch({ database, git, position, source });
		},
	};
}

/**
 * Locates the worktree's current position, falling back to the branch
 * recorded in SQLite for the successor name when HEAD is detached or git
 * cannot be reached.
 * @param git - Git bound to the workspace worktree.
 * @param source - Workspace being continued.
 * @returns The prior position, or `null` when no branch name can be resolved.
 */
async function resolveWorktreePosition(
	git: WorktreeGit,
	source: SourceWorkspace,
): Promise<WorktreePosition | null> {
	const head = await git.value(['rev-parse', '--abbrev-ref', 'HEAD']);
	if (head && head !== DETACHED_HEAD_LABEL) {
		return { continuationBase: head, restoreTarget: head };
	}
	if (!source.branchName) {
		return null;
	}
	const headCommit = await git.value(['rev-parse', 'HEAD']);
	return {
		continuationBase: source.branchName,
		restoreTarget: headCommit ?? source.branchName,
	};
}

/**
 * Lists every branch name a successor could collide with, local and
 * remote-tracking alike, so a name that survives only as `origin/<name>` is
 * not handed out again.
 * @param git - Git bound to the workspace worktree.
 * @returns The claimed branch names.
 */
async function listClaimedBranchNames(git: WorktreeGit): Promise<string[]> {
	const result = await git.run([
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
 * Reads the head commit of the merged pull request the workspace is moving
 * off, before the continue drops that snapshot. It marks where the commits
 * GitHub merged end and any follow-up commits begin.
 * @param database - Open SQLite connection.
 * @param workspaceId - Workspace being continued.
 * @returns The merged head commit, or `null` when no merged PR is cached.
 */
function readMergedHeadCommit(
	database: DatabaseSync,
	workspaceId: string,
): string | null {
	const pullRequest = readCachedPullRequestSnapshot({
		database,
		workspaceId,
	})?.pullRequest;
	return pullRequest?.state === 'merged' && pullRequest.headRefOid
		? pullRequest.headRefOid
		: null;
}

/**
 * Checks out the successor where the plan says, then replays any follow-up
 * commits onto it, falling back to a fork from HEAD when the replay conflicts.
 * @param baseBranch - Base the workspace merges into, for messages.
 * @param git - Git bound to the workspace worktree.
 * @param nextBranch - Successor branch to create.
 * @param plan - Where to fork and what to replay.
 * @param position - Position captured before the switch.
 * @returns The placement outcome and its diagnostics.
 */
async function placeSuccessor({
	baseBranch,
	git,
	nextBranch,
	plan,
	position,
}: {
	baseBranch: string;
	git: WorktreeGit;
	nextBranch: string;
	plan: PlacementPlan;
	position: WorktreePosition;
}): Promise<SuccessorPlacement> {
	if (plan.kind === 'keep-head') {
		return checkoutSuccessor({
			git,
			nextBranch,
			startPoint: null,
			warnings: plan.warnings,
		});
	}

	const placed = await checkoutSuccessor({
		git,
		nextBranch,
		startPoint: plan.baseCommit,
		warnings: plan.warnings,
	});
	if (placed.status === 'failure' || !plan.replay) {
		return placed;
	}

	const replay = await git.run(
		[
			'cherry-pick',
			'--keep-redundant-commits',
			`${plan.replay.from}..${plan.replay.to}`,
		],
		REPLAY_TIMEOUT_MS,
	);
	if (replay.status === 'success') {
		return placed;
	}
	return fallBackFromFailedReplay({
		git,
		nextBranch,
		position,
		reason: replayFailure(baseBranch, replay.stderr),
		warnings: plan.warnings,
	});
}

/**
 * Abandons a replay that stopped part-way: aborts the cherry-pick, puts the
 * worktree back on the merged branch, and forks the successor from HEAD. When
 * the worktree cannot be put back, that leads the diagnostics, since it is
 * what the user has to deal with.
 * @param git - Git bound to the workspace worktree.
 * @param nextBranch - Successor branch being created.
 * @param position - Position captured before the switch.
 * @param reason - Why the replay was abandoned.
 * @param warnings - Warnings the plan already carried.
 * @returns The placement outcome after the fallback.
 */
async function fallBackFromFailedReplay({
	git,
	nextBranch,
	position,
	reason,
	warnings,
}: {
	git: WorktreeGit;
	nextBranch: string;
	position: WorktreePosition;
	reason: ContinueWorkspaceBranchDiagnostic;
	warnings: readonly ContinueWorkspaceBranchDiagnostic[];
}): Promise<SuccessorPlacement> {
	const rollback =
		(await abortReplay(git, nextBranch)) ??
		(await restoreWorktree({ git, nextBranch, position }));
	if (rollback) {
		return {
			diagnostics: [rollback, { ...reason, severity: 'error' }],
			status: 'failure',
		};
	}
	return checkoutSuccessor({
		git,
		nextBranch,
		startPoint: null,
		warnings: [reason, ...warnings],
	});
}

/**
 * Aborts a stopped cherry-pick. A cherry-pick that refused to start leaves
 * nothing to abort, so success is judged by whether one is still in progress
 * rather than by the abort's own exit code.
 * @param git - Git bound to the workspace worktree.
 * @param nextBranch - Successor branch the replay ran on.
 * @returns A warning diagnostic when the cherry-pick is still in progress.
 */
async function abortReplay(
	git: WorktreeGit,
	nextBranch: string,
): Promise<ContinueWorkspaceBranchDiagnostic | null> {
	const abort = await git.run(['cherry-pick', '--abort']);
	// The probe reads the repository state the abort just changed, an ordering
	// the analyzer cannot see because no value passes between the two calls.
	// oxlint-disable-next-line react-doctor/server-sequential-independent-await
	const stillPicking = await git.succeeds([
		'rev-parse',
		'--verify',
		'--quiet',
		'CHERRY_PICK_HEAD',
	]);
	return stillPicking
		? {
				code: 'branch-rollback-failed',
				message: `The worktree is still on "${nextBranch}" with a cherry-pick in progress — aborting it failed: ${firstLine(abort.stderr) || 'git cherry-pick --abort failed.'}`,
				severity: 'warning',
			}
		: null;
}

/**
 * Creates and checks out the successor branch.
 *
 * `--no-track` keeps the successor from adopting an upstream it has no
 * remote counterpart for, which would make `gh pr view` resolve that
 * branch's pull request as if it were the successor's.
 * @param git - Git bound to the workspace worktree.
 * @param nextBranch - Successor branch to create.
 * @param startPoint - Commit to fork from; `null` forks from HEAD.
 * @param warnings - Warnings to report when the checkout succeeds.
 * @returns The placement outcome.
 */
async function checkoutSuccessor({
	git,
	nextBranch,
	startPoint,
	warnings,
}: {
	git: WorktreeGit;
	nextBranch: string;
	startPoint: string | null;
	warnings: readonly ContinueWorkspaceBranchDiagnostic[];
}): Promise<SuccessorPlacement> {
	const checkout = await git.run([
		'checkout',
		'--no-track',
		'-b',
		nextBranch,
		...(startPoint ? [startPoint] : []),
	]);
	if (checkout.status === 'success') {
		return { diagnostics: [...warnings], status: 'success' };
	}
	return {
		diagnostics: [
			{
				code: 'branch-checkout-failed',
				message:
					firstLine(checkout.stderr) ||
					`Could not create branch "${nextBranch}".`,
				severity: 'error',
			},
		],
		status: 'failure',
	};
}

/**
 * Puts the worktree back where it started and drops the half-created branch.
 * @param git - Git bound to the workspace worktree.
 * @param nextBranch - Successor branch to remove.
 * @param position - Position captured before the switch.
 * @returns A warning diagnostic when the worktree could not be restored.
 */
async function restoreWorktree({
	git,
	nextBranch,
	position,
}: {
	git: WorktreeGit;
	nextBranch: string;
	position: WorktreePosition;
}): Promise<ContinueWorkspaceBranchDiagnostic | null> {
	const checkout = await git.run(['checkout', position.restoreTarget]);
	if (checkout.status !== 'success') {
		return {
			code: 'branch-rollback-failed',
			message: `The worktree is still on "${nextBranch}" — restoring "${position.restoreTarget}" failed: ${firstLine(checkout.stderr) || 'git checkout failed.'}`,
			severity: 'warning',
		};
	}
	const remove = await git.run(['branch', '-D', nextBranch]);
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
 * Describes a follow-up replay that could not complete cleanly.
 * @param baseBranch - Base the commits were replayed onto.
 * @param stderr - What `git cherry-pick` reported.
 * @returns The warning diagnostic.
 */
function replayFailure(
	baseBranch: string,
	stderr: string,
): ContinueWorkspaceBranchDiagnostic {
	const detail = firstLine(stderr);
	return {
		code: 'follow-up-replay-failed',
		message: `Commits made after the pull request merged could not be replayed onto "${baseBranch}"${detail ? ` (${detail})` : ''}, so the new branch kept the previous base and its diff will include already-merged work.`,
		severity: 'warning',
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
