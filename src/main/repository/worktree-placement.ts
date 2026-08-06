import { existsSync, rmSync } from 'node:fs';

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
	syncBaseRef,
	type WorktreeBranchPlacement,
} from './git-ops.ts';
import { validateGitRef } from './validate-git-ref.ts';

const ORIGIN_REMOTE = 'origin';
const GIT_WORKTREE_LIST_MAX_OUTPUT_BYTES = 256 * 1024;

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

	// If the target now exists despite the pre-check, another worker won a
	// TOCTOU race or the directory materialized concurrently. Do not delete it —
	// it belongs to whoever got there first.
	if (existsSync(request.workspacePath)) {
		return {
			diagnostic: {
				code: 'destination-exists',
				message: `A file or directory already exists at ${request.workspacePath}.`,
				path: request.workspacePath,
				severity: 'error',
			},
		};
	}
	cleanupWorkspaceDirectory(request.workspacePath);
	return { diagnostic: worktreeDiagnostic };
}

/** Removes a half-created workspace directory; failures are swallowed. */
export function cleanupWorkspaceDirectory(workspacePath: string): void {
	try {
		rmSync(workspacePath, { force: true, recursive: true });
	} catch {
		// Best effort: leave any stuck files for the user to clean.
	}
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
 * @param plan - How the workspace's branch comes into being.
 * @returns The fork point, or null.
 */
function forkRefOf(plan: WorkspaceBranchPlan): string | null {
	return plan.kind === 'create' ? (plan.forkRef ?? null) : null;
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
	const refs = [
		request.baseBranch,
		adoptedBranchOf(request.plan),
		forkRefOf(request.plan),
	].filter((ref): ref is string => ref !== null);
	const rejection = refs
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
		forkRefOf(request.plan) ?? `${ORIGIN_REMOTE}/${request.branchName}`;
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
		return readWorktreePathForBranch(result.stdout, branchName);
	} catch {
		return null;
	}
}

/**
 * Scans `git worktree list --porcelain` output for the worktree holding a
 * branch. Each record opens with a `worktree <path>` line and names its branch
 * on a later `branch refs/heads/<name>` line.
 * @param stdout - Raw porcelain output.
 * @param branchName - Branch to look for.
 * @returns The worktree path holding the branch, or null.
 */
export function readWorktreePathForBranch(
	stdout: string,
	branchName: string,
): string | null {
	const worktreePrefix = 'worktree ';
	const branchLine = `branch refs/heads/${branchName}`;
	let currentPath: string | null = null;
	for (const line of stdout.split('\n')) {
		const entry = line.trim();
		if (entry.startsWith(worktreePrefix)) {
			currentPath = entry.slice(worktreePrefix.length);
		} else if (entry === branchLine) {
			return currentPath;
		}
	}
	return null;
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
			diagnostic: {
				code: 'branch-already-checked-out',
				message: `Branch "${request.branchName}" is already checked out at ${occupiedBy}. Open that workspace, or duplicate the branch to work on a copy.`,
				path: occupiedBy,
				severity: 'error',
			},
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
	const forkRef = forkRefOf(request.plan);
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
