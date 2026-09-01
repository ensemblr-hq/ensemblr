import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { restoreWorkspaceTo } from '../checkpoints/index.ts';
import type { LocalCommandService } from '../commands/local-command';
import { stripLaunchContextEnv } from '../environment/launch-env.ts';
import { clearSetupStateFile } from '../scripts/index.ts';
import { copyDirectoryTree } from './copy-directory.ts';
import {
	GIT_WORKTREE_TIMEOUT_MS,
	refResolvesToCommit,
	runWorktreeAdd,
} from './git-ops.ts';
import { ARCHIVED_FILES_TO_COPY_DIRECTORY } from './prune-worktree.ts';

const execFileAsync = promisify(execFile);

/**
 * Why a rehydrate could not put the worktree back. Both map onto unarchive
 * diagnostic codes so the renderer can say which recovery is available.
 */
export type RehydrateFailureReason =
	| 'branch-missing'
	| 'snapshot-missing'
	| 'worktree-add-failed';

/** What putting a pruned worktree back produced. */
export type RehydrateWorktreeOutcome =
	| { message: string; reason: RehydrateFailureReason; status: 'failure' }
	| {
			/** True when the branch was gone and had to be recreated at the recorded commit. */
			branchRecreated: boolean;
			status: 'success';
			/** True when a captured working tree was restored on top of the checkout. */
			workingTreeRestored: boolean;
	  };

/**
 * Re-derives a pruned workspace's worktree from git and puts back everything
 * the prune preserved.
 *
 * The branch still exists, so this checks it out rather than cutting a new one
 * from the base — which is what separates a reclaimed workspace from a
 * discarded one. A branch the user deleted outside the app is recreated at the
 * commit the prune recorded, which the private ref kept alive.
 * @param options - Recorded prune state, paths, and git dependencies.
 * @returns Whether the worktree is back, or the failure that stopped it.
 */
export async function rehydrateWorktree({
	archivedContextPath,
	branchName,
	localCommandService,
	prunedHeadCommit,
	prunedWipCommit,
	repositoryPath,
	workspacePath,
}: {
	archivedContextPath: string | null;
	branchName: string;
	localCommandService: LocalCommandService;
	prunedHeadCommit: string | null;
	prunedWipCommit: string | null;
	repositoryPath: string;
	workspacePath: string;
}): Promise<RehydrateWorktreeOutcome> {
	// A prune removes the admin entry with the directory, but an interrupted one
	// can leave it behind and `git worktree add` refuses a registered path.
	await pruneWorktreeAdmin({ localCommandService, repositoryPath });

	const placement = await resolvePlacement({
		branchName,
		localCommandService,
		prunedHeadCommit,
		repositoryPath,
	});
	if ('message' in placement) {
		return placement;
	}

	const added = await runWorktreeAdd({
		branchName,
		localCommandService,
		placement: placement.placement,
		repositoryPath,
		workspacePath,
	});
	if (added.status !== 'success') {
		return {
			message: added.message,
			reason: 'worktree-add-failed',
			status: 'failure',
		};
	}

	const workingTreeRestored = await restoreWorkingTree({
		prunedWipCommit,
		workspacePath,
	});

	if (archivedContextPath) {
		await restorePreservedFilesToCopy({ archivedContextPath, workspacePath });
	}

	return {
		branchRecreated: placement.placement.kind !== 'checkout',
		status: 'success',
		workingTreeRestored,
	};
}

/**
 * Clears the setup marker a restored `.context/` carries, so the next open
 * re-runs setup.
 *
 * A pruned workspace comes back without its dependencies while its `.context/`
 * — the marker included — is restored verbatim from the archive. Left in place
 * the marker would claim setup already ran and the lifecycle service would skip
 * the very run that rebuilds `node_modules`. Called after the context restore
 * rather than inside it, since that restore is shared with unpruned archives.
 * @param workspacePath - Absolute path to the rehydrated worktree.
 */
export function invalidateSetupMarker(workspacePath: string): void {
	clearSetupStateFile(workspacePath);
}

/**
 * Decides how `git worktree add` should place the branch: check it out when it
 * still exists, otherwise recreate it at the commit the prune recorded.
 * @param options - Branch, recorded commit, and git dependencies.
 * @returns The placement, or the failure explaining why neither is possible.
 */
async function resolvePlacement({
	branchName,
	localCommandService,
	prunedHeadCommit,
	repositoryPath,
}: {
	branchName: string;
	localCommandService: LocalCommandService;
	prunedHeadCommit: string | null;
	repositoryPath: string;
}): Promise<
	| { message: string; reason: RehydrateFailureReason; status: 'failure' }
	| { placement: { forkRef: string; kind: 'create' } | { kind: 'checkout' } }
> {
	const branchExists = await refResolvesToCommit({
		localCommandService,
		ref: `refs/heads/${branchName}`,
		repositoryPath,
	});
	if (branchExists) {
		return { placement: { kind: 'checkout' } };
	}

	if (!prunedHeadCommit) {
		return {
			message: `Branch "${branchName}" no longer exists and this archive predates commit-level prune records, so the worktree cannot be restored.`,
			reason: 'branch-missing',
			status: 'failure',
		};
	}

	const commitExists = await refResolvesToCommit({
		localCommandService,
		ref: prunedHeadCommit,
		repositoryPath,
	});
	if (!commitExists) {
		return {
			message: `Branch "${branchName}" was deleted and commit ${prunedHeadCommit} is no longer in the repository, so the worktree cannot be restored.`,
			reason: 'snapshot-missing',
			status: 'failure',
		};
	}

	return { placement: { forkRef: prunedHeadCommit, kind: 'create' } };
}

/**
 * Restores the captured working tree over the fresh checkout, then unstages it.
 *
 * `read-tree -u --reset` leaves the index matching the snapshot, which reads as
 * a pile of staged changes; the `reset` that follows puts tracked edits back as
 * unstaged and previously untracked files back as untracked. The one thing not
 * reproduced is the original staged/unstaged split — no content is lost.
 * @param options - Recorded snapshot commit and the rehydrated worktree.
 * @returns True when a snapshot was restored.
 */
async function restoreWorkingTree({
	prunedWipCommit,
	workspacePath,
}: {
	prunedWipCommit: string | null;
	workspacePath: string;
}): Promise<boolean> {
	if (!prunedWipCommit) {
		return false;
	}

	try {
		await restoreWorkspaceTo({
			commitHash: prunedWipCommit,
			cwd: workspacePath,
		});
		await execFileAsync('git', ['reset', '--quiet'], {
			cwd: workspacePath,
			env: stripLaunchContextEnv({ ...process.env }),
		});
		return true;
	} catch {
		// The checkout itself is intact, so a failed snapshot restore costs the
		// uncommitted work rather than the workspace; unarchive reports it.
		return false;
	}
}

/**
 * Copies the preserved files-to-copy matches back into the rehydrated worktree.
 *
 * This is the only thing that puts them back — unarchive has no files-to-copy
 * step, so nothing re-seeds them from the repository root. The directory is
 * absent only when the workspace had no matches to preserve, since the prune
 * refuses to remove a worktree whose matches it could not copy out.
 * @param options - Preserved archive directory and the rehydrated worktree.
 */
async function restorePreservedFilesToCopy({
	archivedContextPath,
	workspacePath,
}: {
	archivedContextPath: string;
	workspacePath: string;
}): Promise<void> {
	const preserved = path.join(
		archivedContextPath,
		ARCHIVED_FILES_TO_COPY_DIRECTORY,
	);
	if (!existsSync(preserved)) {
		return;
	}
	await copyDirectoryTree(preserved, workspacePath);
}

/** Best-effort `git worktree prune`; a failure surfaces on the add that follows. */
async function pruneWorktreeAdmin({
	localCommandService,
	repositoryPath,
}: {
	localCommandService: LocalCommandService;
	repositoryPath: string;
}): Promise<void> {
	try {
		await localCommandService.run({
			args: ['worktree', 'prune'],
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes: 4 * 1024,
			timeoutMs: GIT_WORKTREE_TIMEOUT_MS,
		});
	} catch {
		// Leave it to `git worktree add` to report a registry it could not clear.
	}
}
