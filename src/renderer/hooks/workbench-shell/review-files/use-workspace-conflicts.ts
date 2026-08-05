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
	const localConflicts = useMemo(
		() =>
			workspace.reviewFiles
				.filter((file) => file.status === 'conflicted')
				.map((file) => file.path),
		[workspace.reviewFiles],
	);
	const baseRef = workspace.landingSummary?.branchSource.baseBranch ?? null;
	// No `keepPreviousData`: the key carries the workspace, so carrying the last
	// result across a switch would name another workspace's files here — and the
	// probe runs a `git fetch`, long enough for that to be read and acted on.
	const { data } = useQuery(
		workspaceMergeConflictsQuery({
			baseRef,
			enabled: localConflicts.length === 0,
			workspaceCwd: workspace.pathLabel ?? null,
		}),
	);

	return useMemo(() => {
		if (localConflicts.length > 0) {
			return { paths: new Set(localConflicts) };
		}
		if (!data) {
			return NO_CONFLICTS;
		}
		return {
			...(data.error ? { error: data.error } : {}),
			paths: new Set(data.paths),
		};
	}, [data, localConflicts]);
}
