import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

import type {
	CreateWorkspaceDiagnostic,
	WorkspaceBranchPlan,
} from '../../shared/ipc/contracts/workspace';
import type { LocalCommandService } from '../commands/local-command';
import {
	ensureBaseRefAvailable,
	GIT_WORKTREE_TIMEOUT_MS,
	readOriginTrackingRef,
	refResolvesToCommit,
	runWorktreeAdd as runWorktreeAddShared,
	runWorktreePrune,
	syncBaseRef,
	type WorktreeBranchPlacement,
} from './git-ops.ts';
import { removeDirectoryTree } from './remove-directory.ts';
import { validateGitRef } from './validate-git-ref.ts';

const ORIGIN_REMOTE = 'origin';
const GIT_WORKTREE_LIST_MAX_OUTPUT_BYTES = 256 * 1024;
const WORKTREE_PATH_PREFIX = 'worktree ';

/**
 * Everything the worktree needs to exist: where it goes, which branch it
 * carries, how that branch comes into being, and the branch it will be measured
 * against once it does.
 */
export interface WorktreePlacementRequest {
	/** Merge target: diff base, conflict probe, and pull-request base. */
	baseBranch: string;
	branchName: string;
	plan: WorkspaceBranchPlan;
	workspacePath: string;
}

/**
 * A worktree that now exists on disk. `createdBranch` tells the caller whether a
 * rollback may delete the branch: a branch this creation cut is disposable, one
 * it moved across from an existing local branch is the user's and may still back
 * a pull request.
 */
export interface WorktreeCreated {
	createdBranch: boolean;
}

/**
 * Materializes a workspace's worktree: validates its refs, refreshes them,
 * settles how the branch will be placed, and runs `git worktree add`, cleaning
 * up the destination when git fails.
 * @param options - Placement request plus git command dependencies.
 * @returns The created worktree, or the diagnostic that blocked creation.
 */
export async function createWorktree({
	localCommandService,
	repositoryPath,
	request,
}: {
	localCommandService: LocalCommandService;
	repositoryPath: string;
	request: WorktreePlacementRequest;
}): Promise<{ diagnostic: CreateWorkspaceDiagnostic } | WorktreeCreated> {
	const planned = await planBranchPlacement({
		localCommandService,
		repositoryPath,
		request,
	});
	if ('diagnostic' in planned) {
		return planned;
	}

	// Sampled before git runs, because it is the only way to tell a directory
	// this attempt must not touch from one git itself left behind.
	const destinationPredatesAdd = existsSync(request.workspacePath);
	const worktreeDiagnostic = await runWorktreeAdd({
		branchName: request.branchName,
		localCommandService,
		placement: planned.placement,
		repositoryPath,
		workspacePath: request.workspacePath,
	});
	if (!worktreeDiagnostic) {
		return { createdBranch: planned.placement.kind !== 'checkout' };
	}

	// A destination that was already there lost a TOCTOU race against another
	// worker and belongs to whoever got there first, so it stays. Anything else
	// is this attempt's own debris: git creates the directory before it checks
	// out, and a failure partway (full disk, unwritable path, a retry that trips
	// over the previous attempt) leaves it behind. Keeping it would strand the
	// slug, since every later creation resolves the same path and reports a
	// stale "already exists" in place of the real error.
	if (destinationPredatesAdd) {
		return {
			diagnostic: {
				code: 'destination-exists',
				message: `A file or directory already exists at ${request.workspacePath}.`,
				path: request.workspacePath,
				severity: 'error',
			},
		};
	}
	await cleanupWorkspaceDirectory(request.workspacePath);
	return { diagnostic: worktreeDiagnostic };
}

/** Removes a half-created workspace directory; failures are swallowed. */
export async function cleanupWorkspaceDirectory(
	workspacePath: string,
): Promise<void> {
	await removeDirectoryTree(workspacePath);
}

/**
 * The branch this placement adopts, or null when it cuts a new one.
 * @param plan - How the workspace's branch comes into being.
 * @returns The adopted branch name, or null.
 */
function adoptedBranchOf(plan: WorkspaceBranchPlan): string | null {
	return plan.kind === 'adopt' ? plan.branch : null;
}

/**
 * The commit a newly cut branch starts at, or null when the plan adopts an
 * existing branch instead.
 *
 * A `create` plan that names no fork point cuts from the base branch. The
 * default belongs here rather than at the caller: without it a fork point of
 * null reads as an adoption further down, and a branch this placement was asked
 * to *make* would be rejected as one it could not find.
 * @param request - The placement request.
 * @returns The fork point, or null.
 */
function forkRefOf(request: WorktreePlacementRequest): string | null {
	return request.plan.kind === 'create'
		? (request.plan.forkRef ?? request.baseBranch)
		: null;
}

/**
 * Rejects refs that git would refuse or that could smuggle an option into a
 * later git invocation, before any of them reach a command line.
 * @param request - The placement request.
 * @returns A diagnostic naming the problem, or null when every ref is usable.
 */
function validatePlacementRefs(
	request: WorktreePlacementRequest,
): CreateWorkspaceDiagnostic | null {
	const refs = new Set(
		[
			request.baseBranch,
			adoptedBranchOf(request.plan),
			forkRefOf(request),
		].filter((ref): ref is string => ref !== null),
	);
	const rejection = [...refs]
		.map((ref) => validateGitRef(ref))
		.find((result) => result !== null);
	return rejection
		? {
				code: 'branch-name-invalid',
				message: rejection.message,
				severity: 'error',
			}
		: null;
}

/**
 * The refs a placement depends on: the merge target it will be diffed against,
 * plus the fork point it cuts from — or, for an adopted branch, that branch's
 * remote tip, which must exist locally before the worktree can track it.
 * @param request - The placement request.
 * @returns The refs to refresh, deduplicated.
 */
function refsRequiredBy(request: WorktreePlacementRequest): string[] {
	const branchSource =
		forkRefOf(request) ?? `${ORIGIN_REMOTE}/${request.branchName}`;
	return [...new Set([request.baseBranch, branchSource])];
}

/**
 * Refreshes each ref from its remote, one at a time so concurrent fetches never
 * contend for the repository's git lock. Entirely best-effort.
 * @param options - Refs to refresh plus git command dependencies.
 */
async function prepareGitRefs({
	localCommandService,
	refs,
	repositoryPath,
}: {
	localCommandService: LocalCommandService;
	refs: readonly string[];
	repositoryPath: string;
}): Promise<void> {
	for (const ref of refs) {
		// Parallelizing these fetches would make them contend for the repository's
		// single git index lock and fail intermittently.
		// oxlint-disable-next-line react-doctor/async-await-in-loop
		await syncBaseRef({
			baseBranch: ref,
			localCommandService,
			repositoryPath,
		});
		await ensureBaseRefAvailable({
			baseBranch: ref,
			localCommandService,
			repositoryPath,
		});
	}
}

/**
 * Finds the worktree that already has `branchName` checked out. Git allows a
 * branch in only one worktree at a time, so adopting one it already holds must
 * fail with a diagnostic that names the holder rather than a raw git error.
 *
 * A prunable holder is not a holder. Its registration outlived the directory it
 * points at — a delete or archive whose `git worktree remove` failed and which
 * unlinked the folder anyway — so it blocks a branch nothing is actually using.
 * Pruning is scoped to having found one for this branch rather than run on
 * every creation, because `git worktree prune` has no per-entry granularity.
 * @param options - Branch to look for plus git command dependencies.
 * @returns The holding worktree's path, or null when the branch is free.
 */
async function findWorktreeHoldingBranch({
	branchName,
	localCommandService,
	repositoryPath,
}: {
	branchName: string;
	localCommandService: LocalCommandService;
	repositoryPath: string;
}): Promise<string | null> {
	try {
		const result = await localCommandService.run({
			args: ['worktree', 'list', '--porcelain'],
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes: GIT_WORKTREE_LIST_MAX_OUTPUT_BYTES,
			timeoutMs: GIT_WORKTREE_TIMEOUT_MS,
		});
		if (result.status !== 'success') {
			return null;
		}
		const holder = readWorktreeHolderForBranch(result.stdout, branchName);
		if (!holder) {
			return null;
		}
		if (!holder.prunable) {
			return holder.path;
		}
		await runWorktreePrune({ localCommandService, repositoryPath });
		return null;
	} catch {
		return null;
	}
}

/**
 * The worktree holding a branch, as `git worktree list --porcelain` describes
 * it. `prunable` marks a registration whose directory is gone: git still lists
 * it, but it holds nothing that can be opened and a prune clears it.
 */
export interface WorktreeBranchHolder {
	path: string;
	prunable: boolean;
}

/**
 * Scans `git worktree list --porcelain` output for the worktree holding a
 * branch. Each record opens with a `worktree <path>` line and names its branch
 * on a later `branch refs/heads/<name>` line.
 *
 * The whole record is read before answering rather than returning at the branch
 * line, because git emits `prunable` *after* `branch` — and that annotation is
 * the difference between a branch another worktree is genuinely using and one
 * whose worktree was deleted out from under its registration.
 * @param stdout - Raw porcelain output.
 * @param branchName - Branch to look for.
 * @returns The worktree holding the branch, or null when no record names it.
 */
export function readWorktreeHolderForBranch(
	stdout: string,
	branchName: string,
): WorktreeBranchHolder | null {
	const branchLine = `branch refs/heads/${branchName}`;
	for (const record of readWorktreeRecords(stdout)) {
		const pathLine = record.find((line) =>
			line.startsWith(WORKTREE_PATH_PREFIX),
		);
		if (pathLine && record.includes(branchLine)) {
			return {
				path: pathLine.slice(WORKTREE_PATH_PREFIX.length),
				prunable: record.some(isPrunableLine),
			};
		}
	}
	return null;
}

/**
 * Splits porcelain output into one record per worktree. Git separates records
 * with a blank line and terminates the last one with a newline.
 * @param stdout - Raw porcelain output.
 * @returns One array of non-empty trimmed lines per worktree record.
 */
function readWorktreeRecords(stdout: string): string[][] {
	return stdout
		.split(/\n\s*\n/)
		.map((record) =>
			record
				.split('\n')
				.map((line) => line.trim())
				.filter((line) => line.length > 0),
		)
		.filter((record) => record.length > 0);
}

/**
 * Reports whether a porcelain line is git's `prunable` annotation, which it
 * writes bare or followed by the reason the entry became prunable.
 * @param line - A trimmed porcelain line.
 * @returns True when the line marks its record prunable.
 */
function isPrunableLine(line: string): boolean {
	return line === 'prunable' || line.startsWith('prunable ');
}

/**
 * Compares two paths by their real location. Git reports worktree paths with
 * symlinks resolved, so a repository registered under `/var/...` on macOS comes
 * back as `/private/var/...` and a plain string compare would miss the match.
 * @param left - First path.
 * @param right - Second path.
 * @returns True when both name the same directory.
 */
export function isSamePath(left: string, right: string): boolean {
	try {
		return realpathSync(left) === realpathSync(right);
	} catch {
		return path.resolve(left) === path.resolve(right);
	}
}

/**
 * Explains that a branch is spoken for, pointing at whoever holds it. The
 * repository folder is called out by name: it is not a workspace, so telling the
 * user to open it would send them nowhere.
 * @param options - The branch, its holder, and the repository root.
 * @returns The rejection diagnostic.
 */
function occupiedDiagnostic({
	branchName,
	occupiedBy,
	repositoryPath,
}: {
	branchName: string;
	occupiedBy: string;
	repositoryPath: string;
}): CreateWorkspaceDiagnostic {
	const heldByRepository = isSamePath(occupiedBy, repositoryPath);
	return {
		code: 'branch-already-checked-out',
		message: heldByRepository
			? `Branch "${branchName}" is checked out in the repository folder at ${occupiedBy}, and git allows a branch in one worktree at a time. Duplicate the branch to work on a copy.`
			: `Branch "${branchName}" is already checked out at ${occupiedBy}. Open that workspace, or duplicate the branch to work on a copy.`,
		path: occupiedBy,
		severity: 'error',
	};
}

/**
 * Refreshes the refs the placement depends on, then settles how `git worktree
 * add` will place its branch — refusing up front when the branch is already
 * checked out in another worktree, which git would reject anyway but only after
 * three retries and with a far less actionable message.
 *
 * The ref refresh is best-effort: offline, divergence, or a dirty tree degrades
 * to the local refs rather than blocking creation.
 * @param options - Placement request plus git command dependencies.
 * @returns The placement to hand `git worktree add`, or the diagnostic that
 * blocks creation.
 */
async function planBranchPlacement({
	localCommandService,
	repositoryPath,
	request,
}: {
	localCommandService: LocalCommandService;
	repositoryPath: string;
	request: WorktreePlacementRequest;
}): Promise<
	| { diagnostic: CreateWorkspaceDiagnostic }
	| { placement: WorktreeBranchPlacement }
> {
	const refDiagnostic = validatePlacementRefs(request);
	if (refDiagnostic) {
		return { diagnostic: refDiagnostic };
	}

	await prepareGitRefs({
		localCommandService,
		refs: refsRequiredBy(request),
		repositoryPath,
	});

	const occupiedBy = adoptedBranchOf(request.plan)
		? await findWorktreeHoldingBranch({
				branchName: request.branchName,
				localCommandService,
				repositoryPath,
			})
		: null;
	if (occupiedBy) {
		return {
			diagnostic: occupiedDiagnostic({
				branchName: request.branchName,
				occupiedBy,
				repositoryPath,
			}),
		};
	}

	const placement = await resolveBranchPlacement({
		localCommandService,
		repositoryPath,
		request,
	});
	return placement
		? { placement }
		: {
				diagnostic: {
					code: 'branch-not-found',
					message: `Branch "${request.branchName}" was not found locally or on origin, so the workspace could not take it over.`,
					path: request.workspacePath,
					severity: 'error',
				},
			};
}

/**
 * Decides how `git worktree add` should place the workspace's branch: cut it at
 * the fork point, move an existing local branch across, or create it from its
 * origin tracking ref when the branch so far only exists on the remote.
 * @param options - Placement request plus git command dependencies.
 * @returns The placement, or null when an adopted branch exists nowhere.
 */
async function resolveBranchPlacement({
	localCommandService,
	repositoryPath,
	request,
}: {
	localCommandService: LocalCommandService;
	repositoryPath: string;
	request: WorktreePlacementRequest;
}): Promise<WorktreeBranchPlacement | null> {
	const forkRef = forkRefOf(request);
	if (forkRef) {
		return { forkRef, kind: 'create' };
	}

	const hasLocalBranch = await refResolvesToCommit({
		localCommandService,
		ref: `refs/heads/${request.branchName}`,
		repositoryPath,
	});
	if (hasLocalBranch) {
		return { kind: 'checkout' };
	}

	const remoteRef = await readOriginTrackingRef({
		branch: request.branchName,
		localCommandService,
		repositoryPath,
	});
	return remoteRef ? { kind: 'track', remoteRef } : null;
}

/**
 * Runs `git worktree add` inside the source repo by delegating to the shared
 * {@link runWorktreeAddShared} helper, mapping its outcome onto the
 * create-workspace diagnostic shape.
 * @param options - Branch, placement, destination, and git command dependencies.
 * @returns A diagnostic on failure; `null` on success.
 */
async function runWorktreeAdd({
	branchName,
	localCommandService,
	placement,
	repositoryPath,
	workspacePath,
}: {
	branchName: string;
	localCommandService: LocalCommandService;
	placement: WorktreeBranchPlacement;
	repositoryPath: string;
	workspacePath: string;
}): Promise<CreateWorkspaceDiagnostic | null> {
	const outcome = await runWorktreeAddShared({
		branchName,
		localCommandService,
		placement,
		repositoryPath,
		workspacePath,
	});

	if (outcome.status === 'success') {
		return null;
	}

	if (outcome.status === 'git-missing') {
		return {
			code: 'git-not-installed',
			message: outcome.message,
			severity: 'error',
		};
	}

	return {
		code: 'git-worktree-failed',
		message: outcome.message,
		path: workspacePath,
		severity: 'error',
	};
}
