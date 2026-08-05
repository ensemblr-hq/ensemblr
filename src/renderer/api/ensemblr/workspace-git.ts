import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	DiscardWorkspaceChangesRequest,
	WorkspaceGitDiffScope,
} from '@/shared/ipc/contracts/workspace-git';
import { serializeWorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

const GIT_STATUS_REFETCH_INTERVAL_MS = 10_000;
/**
 * Conflicts appear when the *base* branch moves, which nothing local observes,
 * so this query has to poll rather than wait for an invalidation. It runs a
 * `git fetch` per pass, so it polls far slower than the status query.
 */
const MERGE_CONFLICTS_REFETCH_INTERVAL_MS = 120_000;

/**
 * Query options for a workspace's changed-file rows and +/- summary. The
 * optional `scope` selects what to compare against — the working tree
 * (uncommitted, the default), a specific commit, or the whole branch.
 */
export function workspaceGitStatusQuery(
	workspaceCwd: string | null,
	scope?: WorkspaceGitDiffScope,
) {
	return queryOptions({
		enabled: !!workspaceCwd,
		queryFn: () =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:get-workspace-git-status', usesDatabase: false },
				() =>
					getEnsemblrApi().getWorkspaceGitStatus({
						...(scope ? { scope } : {}),
						workspaceCwd: workspaceCwd ?? '',
					}),
			),
		queryKey: ensemblrQueryKeys.workspaceGitStatus(
			workspaceCwd ?? '',
			serializeWorkspaceGitDiffScope(scope),
		),
		refetchInterval: GIT_STATUS_REFETCH_INTERVAL_MS,
		staleTime: 5_000,
	});
}

/**
 * Query options for the paths that would conflict merging `baseRef` into the
 * workspace branch. Disabled until a base ref is known, since without one there
 * is nothing to merge against.
 *
 * `staleTime` deliberately matches the poll interval: the header, the Checks
 * panel, and the Changes list all read this, and a shorter window would let
 * their mount and unmount churn — not the base branch actually moving — decide
 * how often the workspace talks to the network.
 */
export function workspaceMergeConflictsQuery({
	baseRef,
	enabled = true,
	workspaceCwd,
}: {
	baseRef: string | null;
	/** Lets a caller suspend the probe, e.g. while the worktree is mid-merge. */
	enabled?: boolean;
	workspaceCwd: string | null;
}) {
	return queryOptions({
		enabled: enabled && !!workspaceCwd && !!baseRef,
		queryFn: () =>
			profileElectronIpcCall(
				{
					channel: 'ensemblr:get-workspace-merge-conflicts',
					usesDatabase: false,
				},
				() =>
					getEnsemblrApi().getWorkspaceMergeConflicts({
						baseRef: baseRef ?? '',
						workspaceCwd: workspaceCwd ?? '',
					}),
			),
		queryKey: ensemblrQueryKeys.workspaceMergeConflicts(
			workspaceCwd ?? '',
			baseRef ?? '',
		),
		refetchInterval: MERGE_CONFLICTS_REFETCH_INTERVAL_MS,
		staleTime: MERGE_CONFLICTS_REFETCH_INTERVAL_MS,
	});
}

/**
 * Query options for one file's unified diff. The optional `scope` mirrors
 * {@link workspaceGitStatusQuery}: it defaults to the working-tree diff against
 * HEAD, but can resolve a single commit's diff or the whole-branch diff.
 */
export function workspaceFileDiffQuery({
	filePath,
	scope,
	workspaceCwd,
}: {
	filePath: string | null;
	scope?: WorkspaceGitDiffScope;
	workspaceCwd: string | null;
}) {
	return queryOptions({
		enabled: !!workspaceCwd && !!filePath,
		queryFn: () =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:get-workspace-file-diff', usesDatabase: false },
				() =>
					getEnsemblrApi().getWorkspaceFileDiff({
						path: filePath ?? '',
						...(scope ? { scope } : {}),
						workspaceCwd: workspaceCwd ?? '',
					}),
			),
		queryKey: ensemblrQueryKeys.workspaceFileDiff(
			workspaceCwd ?? '',
			filePath ?? '',
			serializeWorkspaceGitDiffScope(scope),
		),
		staleTime: 5_000,
	});
}

/**
 * Discards working-tree changes for the given workspace-relative paths. Tracked
 * files revert to HEAD; new/untracked files are removed. Irreversible — gate it
 * behind a confirmation and invalidate the status + files queries on success.
 */
export function discardWorkspaceChanges(
	request: DiscardWorkspaceChangesRequest,
) {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:discard-workspace-changes', usesDatabase: false },
		() => getEnsemblrApi().discardWorkspaceChanges(request),
	);
}

/**
 * Query options for the workspace's recent commits, newest first. When
 * `baseRef` is given the list is scoped to commits made on this branch
 * (`merge-base(baseRef, HEAD)..HEAD`), excluding base-branch history.
 */
export function workspaceCommitsQuery(
	workspaceCwd: string | null,
	baseRef?: string | null,
) {
	return queryOptions({
		enabled: !!workspaceCwd,
		queryFn: () =>
			profileElectronIpcCall(
				{ channel: 'ensemblr:get-workspace-commits', usesDatabase: false },
				() =>
					getEnsemblrApi().getWorkspaceCommits({
						...(baseRef ? { baseRef } : {}),
						workspaceCwd: workspaceCwd ?? '',
					}),
			),
		queryKey: ensemblrQueryKeys.workspaceCommits(
			workspaceCwd ?? '',
			baseRef ?? '',
		),
		staleTime: 10_000,
	});
}
