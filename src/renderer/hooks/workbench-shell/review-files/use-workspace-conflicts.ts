import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { workspaceMergeConflictsQuery } from '@/renderer/api/ensemblr';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { WorkspaceGitFailure } from '@/shared/ipc/contracts/workspace-git';

/** Conflict paths plus the reason the trial merge could not answer, if it could not. */
export interface WorkspaceConflicts {
	/** Why the probe failed. Set means "unknown", not "clean". */
	error?: WorkspaceGitFailure;
	paths: ReadonlySet<string>;
}

/** Nothing conflicting and nothing wrong — the answer for a suspended probe. */
const NO_CONFLICTS: WorkspaceConflicts = { paths: new Set() };

/**
 * Workspace-relative paths that cannot merge cleanly with the base branch.
 *
 * Two sources answer the same question at different moments. Once a merge or
 * rebase is underway git already marks the unmerged files, so those rows are
 * authoritative and the trial merge is suspended — running one against a
 * half-merged HEAD would describe a state nobody is in. Before that point the
 * only way to name the files is a trial merge, because GitHub's mergeability
 * signal is a single boolean.
 *
 * An empty result is reported as empty only when the probe actually ran: the
 * service returns no paths both for a clean merge and for a merge it could not
 * attempt, so the failure is passed through for the caller to show rather than
 * being flattened into "this branch is fine".
 *
 * A merged or closed pull request will never be merged again, so the trial
 * merge is skipped once GitHub reports either state — running `git merge-tree`
 * against a base that has since moved on routinely finds "conflicts" nobody can
 * or needs to resolve, which is just noise on an already-settled branch.
 *
 * Shared by the sidebar header, the Changes list, and the Checks panel; all
 * three issue the same query key, so React Query dedupes it to one probe per
 * workspace.
 *
 * @param workspace - Workspace whose branch is being compared to its base.
 * @returns The conflicting paths, and the probe failure when there was one.
 */
export function useWorkspaceConflicts(
	workspace: WorkspaceShellModel,
): WorkspaceConflicts {
	const localConflicts = useMemo(() => {
		const paths: string[] = [];
		for (const file of workspace.reviewFiles) {
			if (file.status === 'conflicted') {
				paths.push(file.path);
			}
		}
		return paths;
	}, [workspace.reviewFiles]);
	const baseRef = workspace.landingSummary?.branchSource.baseBranch ?? null;
	const isSettledPullRequest =
		workspace.pullRequest.state === 'merged' ||
		workspace.pullRequest.state === 'closed';
	// No `keepPreviousData`: the key carries the workspace, so carrying the last
	// result across a switch would name another workspace's files here — and the
	// probe runs a `git fetch`, long enough for that to be read and acted on.
	const { data } = useQuery(
		workspaceMergeConflictsQuery({
			baseRef,
			enabled: localConflicts.length === 0 && !isSettledPullRequest,
			workspaceCwd: workspace.pathLabel ?? null,
		}),
	);

	return useMemo(() => {
		if (localConflicts.length > 0) {
			return { paths: new Set(localConflicts) };
		}
		// Ignore any trial-merge result still cached from before the pull request
		// settled — the query key doesn't carry PR state, so disabling the probe
		// alone doesn't clear a result fetched while it was still open.
		if (isSettledPullRequest || !data) {
			return NO_CONFLICTS;
		}
		return {
			...(data.error ? { error: data.error } : {}),
			paths: new Set(data.paths),
		};
	}, [data, isSettledPullRequest, localConflicts]);
}
