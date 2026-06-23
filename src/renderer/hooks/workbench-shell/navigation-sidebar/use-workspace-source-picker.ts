import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
	linearIssuesQuery,
	repositoryBranchesQuery,
	repositoryIssuesQuery,
	repositoryPullRequestsQuery,
} from '@/renderer/api/ensemble';
import {
	githubIssueSourceId,
	mapGithubIssuesToWorkspaceSources,
} from '@/renderer/lib/github';
import { mapLinearIssuesToWorkspaceSources } from '@/renderer/lib/linear';
import {
	branchSourceId,
	mapPullRequestsToWorkspaceSources,
	mapRepositoryBranchesToWorkspaceSources,
	pullRequestSourceId,
	type WorkspaceSourceItem,
} from '@/renderer/lib/workbench';
import type {
	WorkspaceSource,
	WorkspaceSourceKind,
} from '@/renderer/types/workbench';
import type { GithubFailure } from '@/shared/ipc/contracts/github';

/** Result of the create-from picker's per-repository, per-tab data fetch. */
export interface WorkspaceSourcePickerState {
	error: GithubFailure | null;
	isLoading: boolean;
	itemsById: Map<string, WorkspaceSourceItem>;
	sources: WorkspaceSource[];
}

/**
 * Fetches the create-from picker rows for one repository and the active tab,
 * lazily: only the query for `kind` runs, and only while the dialog is `open`.
 * Linear issues are global (pulled regardless of repo); branches, pull requests,
 * and GitHub issues are scoped to `repoId`. Returns display sources plus a map
 * back to the raw rows so a selection can be turned into a creation seed.
 */
export function useWorkspaceSourcePicker({
	kind,
	open,
	repoId,
}: {
	kind: WorkspaceSourceKind;
	open: boolean;
	repoId: string;
}): WorkspaceSourcePickerState {
	const hasRepo = repoId.length > 0;

	// All three repo lists (plus the global Linear list) load in parallel as soon
	// as the dialog opens — not just the active tab — so flipping tabs reads from
	// cache instead of kicking off a fresh fetch and flashing a loading state.
	const branchesQuery = useQuery({
		...repositoryBranchesQuery(repoId),
		enabled: open && hasRepo,
	});
	const pullRequestsQuery = useQuery({
		...repositoryPullRequestsQuery(repoId),
		enabled: open && hasRepo,
	});
	const githubIssuesQuery = useQuery({
		...repositoryIssuesQuery(repoId),
		enabled: open && hasRepo,
	});
	const linearIssues = useQuery({
		...linearIssuesQuery({}),
		enabled: open,
	});

	return useMemo<WorkspaceSourcePickerState>(() => {
		if (kind === 'branch') {
			const branches = branchesQuery.data?.branches ?? [];
			const itemsById = new Map<string, WorkspaceSourceItem>(
				branches.map((branch) => [
					branchSourceId(branch.name),
					{ branch, kind: 'branch' },
				]),
			);
			return {
				error: errorOf(branchesQuery.data),
				isLoading: branchesQuery.isLoading,
				itemsById,
				sources: mapRepositoryBranchesToWorkspaceSources(branches),
			};
		}

		if (kind === 'pull-request') {
			const pullRequests = pullRequestsQuery.data?.pullRequests ?? [];
			const itemsById = new Map<string, WorkspaceSourceItem>(
				pullRequests.map((pullRequest) => [
					pullRequestSourceId(pullRequest.number),
					{ kind: 'pull-request', pullRequest },
				]),
			);
			return {
				error: errorOf(pullRequestsQuery.data),
				isLoading: pullRequestsQuery.isLoading,
				itemsById,
				sources: mapPullRequestsToWorkspaceSources(pullRequests),
			};
		}

		const githubIssues = githubIssuesQuery.data?.issues ?? [];
		const linearIssueRows = linearIssues.data?.issues ?? [];
		const itemsById = new Map<string, WorkspaceSourceItem>();
		for (const issue of githubIssues) {
			itemsById.set(githubIssueSourceId(issue.number), {
				issue,
				kind: 'github-issue',
			});
		}
		for (const issue of linearIssueRows) {
			itemsById.set(issue.id, { issue, kind: 'linear-issue' });
		}
		return {
			error: errorOf(githubIssuesQuery.data),
			isLoading: githubIssuesQuery.isLoading || linearIssues.isLoading,
			itemsById,
			sources: [
				...mapGithubIssuesToWorkspaceSources(githubIssues),
				...mapLinearIssuesToWorkspaceSources(linearIssueRows),
			],
		};
	}, [
		kind,
		branchesQuery.data,
		branchesQuery.isLoading,
		pullRequestsQuery.data,
		pullRequestsQuery.isLoading,
		githubIssuesQuery.data,
		githubIssuesQuery.isLoading,
		linearIssues.data,
		linearIssues.isLoading,
	]);
}

/** Pulls the typed failure out of a degradable list result, else null. */
function errorOf(
	data: { error?: GithubFailure; status: 'error' | 'ok' } | undefined,
): GithubFailure | null {
	return data?.status === 'error' ? (data.error ?? null) : null;
}
