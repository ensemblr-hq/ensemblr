import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	DiscardWorkspaceChangesRequest,
	WorkspaceGitDiffScope,
} from '@/shared/ipc/contracts/workspace-git';
import { serializeWorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

import { ensembleQueryKeys, getEnsembleApi } from './query-keys';

const GIT_STATUS_REFETCH_INTERVAL_MS = 10_000;

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
				{ channel: 'ensemble:get-workspace-git-status', usesDatabase: false },
				() =>
					getEnsembleApi().getWorkspaceGitStatus({
						...(scope ? { scope } : {}),
						workspaceCwd: workspaceCwd ?? '',
					}),
			),
		queryKey: ensembleQueryKeys.workspaceGitStatus(
			workspaceCwd ?? '',
			serializeWorkspaceGitDiffScope(scope),
		),
		refetchInterval: GIT_STATUS_REFETCH_INTERVAL_MS,
		staleTime: 5_000,
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
				{ channel: 'ensemble:get-workspace-file-diff', usesDatabase: false },
				() =>
					getEnsembleApi().getWorkspaceFileDiff({
						path: filePath ?? '',
						...(scope ? { scope } : {}),
						workspaceCwd: workspaceCwd ?? '',
					}),
			),
		queryKey: ensembleQueryKeys.workspaceFileDiff(
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
		{ channel: 'ensemble:discard-workspace-changes', usesDatabase: false },
		() => getEnsembleApi().discardWorkspaceChanges(request),
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
				{ channel: 'ensemble:get-workspace-commits', usesDatabase: false },
				() =>
					getEnsembleApi().getWorkspaceCommits({
						...(baseRef ? { baseRef } : {}),
						workspaceCwd: workspaceCwd ?? '',
					}),
			),
		queryKey: ensembleQueryKeys.workspaceCommits(
			workspaceCwd ?? '',
			baseRef ?? '',
		),
		staleTime: 10_000,
	});
}
