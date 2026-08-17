import {
	type UseQueryResult,
	useQueries,
	useQuery,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import {
	linearIssuesQuery,
	repositoryIssuesQuery,
} from '@/renderer/api/ensemblr';
import {
	collectBacklogIssues,
	type ProjectGithubIssues,
} from '@/renderer/lib/workbench/board-issues';
import { useBoardIssueDismissals } from '@/renderer/state/workspace';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type {
	BoardIssueCard,
	BoardIssuesFailure,
} from '@/renderer/types/workbench-shell';
import type { GithubFailure } from '@/shared/ipc/contracts/github';
import type { ListRepositoryIssuesResult } from '@/shared/ipc/contracts/workspace-sources';

/** The board's issue cards plus the degradable state its column header shows. */
export interface BoardIssuesState {
	backlogIssues: BoardIssueCard[];
	dismissedIssues: BoardIssueCard[];
	/**
	 * Every repository whose `gh` list failed, named — the rest of the board stays
	 * usable, so the column has to say which repositories it is missing.
	 */
	errors: BoardIssuesFailure[];
	isLoading: boolean;
}

/**
 * Collects every workspace's linked-issue key so an issue that already produced
 * one never doubles up in Backlog.
 * @param projects - The projects currently on the board.
 * @returns The remote issue ids, which are Linear issue ids and GitHub issue URLs.
 */
function collectLinkedIssueKeys(
	projects: readonly ProjectShellModel[],
): string[] {
	return projects.flatMap((project) =>
		project.workspaces.flatMap((workspace) => {
			const remoteId = workspace.landingSummary?.linkedIssue?.remoteId;
			return remoteId ? [remoteId] : [];
		}),
	);
}

/**
 * Folds the per-repository results into one structurally stable value. Without a
 * `combine`, `useQueries` hands back a freshly mapped array on every render, and
 * every memo keyed off it below — down to the board's drag monitor — rebuilds
 * each time. A `combine` result is the only part run through `replaceEqualDeep`.
 * @param results - One query result per repository, in `projects` order.
 * @returns The per-repository payloads and whether any repository is still loading.
 */
function combineRepositoryIssues(
	results: readonly UseQueryResult<ListRepositoryIssuesResult>[],
): {
	data: (ListRepositoryIssuesResult | undefined)[];
	hasPending: boolean;
	isLoading: boolean;
} {
	return {
		data: results.map((result) => result.data),
		hasPending: results.some((result) => result.data === undefined),
		isLoading: results.some((result) => result.isLoading),
	};
}

/**
 * Loads the Backlog column: one `gh issue list` per repository plus the merged
 * Linear list, folded into board cards. Every source is degradable — a repository
 * whose `gh` call failed contributes nothing and is named in `errors`, so the
 * column can say which repositories the list is short of rather than reading as
 * "nothing to do".
 * @param projects - The projects whose repositories to list issues for.
 * @returns The backlog and dismissed issue cards, with loading and failure state.
 */
export function useBoardIssues(
	projects: readonly ProjectShellModel[],
): BoardIssuesState {
	const { dismissedKeys, prune } = useBoardIssueDismissals();
	const github = useQueries({
		combine: combineRepositoryIssues,
		queries: projects.map((project) => repositoryIssuesQuery(project.id, true)),
	});
	const linearResult = useQuery(linearIssuesQuery({}));

	const githubIssuesByProject = useMemo<ProjectGithubIssues[]>(
		() =>
			projects.map((project, index) => ({
				issues: github.data[index]?.issues ?? [],
				projectId: project.id,
				projectName: project.name,
			})),
		[projects, github.data],
	);
	const githubErrors = useMemo<BoardIssuesFailure[]>(
		() =>
			projects.flatMap((project, index) => {
				const failure = failureOf(github.data[index]);
				return failure ? [{ failure, projectName: project.name }] : [];
			}),
		[projects, github.data],
	);
	const isLoading = linearResult.isLoading || github.isLoading;

	const issues = useMemo(
		() =>
			collectBacklogIssues({
				dismissedKeys,
				githubIssuesByProject,
				linearIssues: linearResult.data?.issues ?? [],
				linkedIssueKeys: collectLinkedIssueKeys(projects),
			}),
		[dismissedKeys, githubIssuesByProject, linearResult.data, projects],
	);

	// A dismissed key outlives the issue it names — closed on GitHub, or turned
	// into a workspace — and nothing else ever removes it, so an issue dismissed
	// once would come back dismissed if it ever reappeared. Only prune off a
	// complete, successful load: an empty list from a failed fetch would clear
	// every dismissal the user has.
	const canPrune =
		!isLoading &&
		githubErrors.length === 0 &&
		linearResult.isSuccess &&
		!github.hasPending;
	useEffect(() => {
		if (canPrune) {
			prune([
				...issues.backlog.map((issue) => issue.key),
				...issues.dismissed.map((issue) => issue.key),
			]);
		}
	}, [canPrune, issues, prune]);

	return {
		backlogIssues: issues.backlog,
		dismissedIssues: issues.dismissed,
		errors: githubErrors,
		isLoading,
	};
}

/**
 * Pulls the typed failure out of a degradable issue-list result, else null. A
 * cache-served list reports its `staleError` too: the rows are real but old, and
 * dropping the failure makes them indistinguishable from a current list.
 */
function failureOf(
	data: ListRepositoryIssuesResult | undefined,
): GithubFailure | null {
	if (data?.status === 'error') {
		return data.error;
	}
	return data?.status === 'ok' ? (data.staleError ?? null) : null;
}
