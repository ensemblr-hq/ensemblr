import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import {
	ensemblrQueryKeys,
	workspaceMergeConflictsQuery,
} from '@/renderer/api/ensemblr';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { WorkspaceGitFailure } from '@/shared/ipc/contracts/workspace-git';

/** Conflict paths plus the reason the trial merge could not answer, if it could not. */
export interface WorkspaceConflicts {
	/** Why the probe failed. Set means "unknown", not "clean". */
	error?: WorkspaceGitFailure;
	/**
	 * A trial merge the current state of the branch has not been answered by yet
	 * is in flight, and there is nothing to show meanwhile — no paths and no
	 * failure. Lets a caller distinguish "no conflicts" from "not answered yet".
	 * Stays false for the routine poll, which re-asks a question already
	 * answered.
	 */
	isProbing: boolean;
	paths: ReadonlySet<string>;
}

/** Nothing conflicting and nothing wrong — the answer for a suspended probe. */
const NO_CONFLICTS: WorkspaceConflicts = { isProbing: false, paths: new Set() };

/**
 * Re-probes the trial merge as soon as GitHub's verdict on the branch changes,
 * and reports whether the probe result on file predates the verdict on screen.
 *
 * The two sources run on unrelated clocks: the pull-request snapshot polls every
 * ten seconds, while the trial merge polls every two minutes because each pass
 * costs a `git fetch`. So the header can say "Merge conflicts" — GitHub's
 * boolean — while the Changes list and the Checks panel, which need the file
 * names only the trial merge produces, stay empty for up to the rest of that
 * window. The reverse is just as visible: a resolved branch keeps listing files
 * after the badge clears.
 *
 * A flip of that verdict is the one event that makes the cached probe result
 * known-wrong, so it invalidates rather than waiting for the timer. `unknown`
 * already collapses into `isConflicting: false`, so GitHub recomputing
 * mergeability after a push does not churn. `cancelRefetch` stays off because
 * all three consumers run this effect in the same commit and would otherwise
 * abandon each other's in-flight `git fetch`.
 *
 * The workspace travels with the verdict because none of the three consumers
 * remounts across a workspace switch: comparing the verdict alone would read
 * arriving at a differently-conflicting workspace as a flip and invalidate a
 * result that is both correct and fresh. A switch instead only resets the
 * watermark, since the answer on file belongs to the workspace being left.
 *
 * @param workspaceCwd - Workspace directory the probe runs in.
 * @param baseRef - Base branch the trial merge is against.
 * @param isConflicting - GitHub's current verdict for the pull request.
 * @param dataUpdatedAt - When the probe result currently on file was received.
 * @returns Whether the current verdict is still waiting for its own answer.
 */
function useReprobeOnGithubVerdictChange(
	workspaceCwd: string | null,
	baseRef: string | null,
	isConflicting: boolean,
	dataUpdatedAt: number,
): boolean {
	const queryClient = useQueryClient();
	const lastProbe = useRef({ isConflicting, supersededAt: 0, workspaceCwd });

	useEffect(() => {
		const previous = lastProbe.current;
		const isSameWorkspace = previous.workspaceCwd === workspaceCwd;
		if (isSameWorkspace && previous.isConflicting === isConflicting) {
			return;
		}
		lastProbe.current = {
			isConflicting,
			supersededAt: dataUpdatedAt,
			workspaceCwd,
		};
		if (!isSameWorkspace || !workspaceCwd || !baseRef) {
			return;
		}
		void queryClient.invalidateQueries(
			{
				queryKey: ensemblrQueryKeys.workspaceMergeConflicts(
					workspaceCwd,
					baseRef,
				),
			},
			{ cancelRefetch: false },
		);
	}, [baseRef, dataUpdatedAt, isConflicting, queryClient, workspaceCwd]);

	// Read off the ref rather than state: the invalidation above is what renders
	// the waiting message, so holding the watermark in state would only add a
	// second render to say the same thing.
	return dataUpdatedAt <= lastProbe.current.supersededAt;
}

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
 * workspace. The probe's own poll is slow enough that GitHub's verdict would
 * otherwise reach the header minutes before the file names reach the panels, so
 * a change in that verdict re-probes immediately — see
 * {@link useReprobeOnGithubVerdictChange}.
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
	const { data, dataUpdatedAt, isFetching } = useQuery(
		workspaceMergeConflictsQuery({
			baseRef,
			enabled: localConflicts.length === 0 && !isSettledPullRequest,
			workspaceCwd: workspace.pathLabel ?? null,
		}),
	);
	const isAwaitingAnswer = useReprobeOnGithubVerdictChange(
		workspace.pathLabel ?? null,
		baseRef,
		workspace.pullRequest.isConflicting === true,
		dataUpdatedAt,
	);

	return useMemo(() => {
		if (localConflicts.length > 0) {
			return { isProbing: false, paths: new Set(localConflicts) };
		}
		// Ignore any trial-merge result still cached from before the pull request
		// settled — the query key doesn't carry PR state, so disabling the probe
		// alone doesn't clear a result fetched while it was still open.
		if (isSettledPullRequest) {
			return NO_CONFLICTS;
		}
		if (!data) {
			return { isProbing: isFetching, paths: new Set<string>() };
		}
		// Only a fetch the current verdict is still waiting on counts: the
		// two-minute poll re-asks a question already answered, and treating that
		// as "not answered yet" would flicker the section open on every pass for
		// as long as GitHub and the trial merge disagree. An answer of named
		// paths keeps showing them rather than blinking them out and back.
		const paths = new Set(data.paths);
		return {
			...(data.error ? { error: data.error } : {}),
			isProbing:
				isFetching && isAwaitingAnswer && paths.size === 0 && !data.error,
			paths,
		};
	}, [
		data,
		isAwaitingAnswer,
		isFetching,
		isSettledPullRequest,
		localConflicts,
	]);
}
