import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
	linearIssuesQuery,
	repositoryBranchesQuery,
	repositoryIssuesQuery,
	repositoryLinearTeamsQuery,
	repositoryPullRequestsQuery,
} from '@/renderer/api/ensemblr';
import { githubIssueSourceId } from '@/renderer/lib/github';
import {
	describeLinearListGap,
	isLinearIssueInTeamScope,
	mapLinearIssuesToWorkspaceSources,
} from '@/renderer/lib/linear';
import {
	branchSourceId,
	collectLinkedIssueKeys,
	mapPullRequestsToWorkspaceSources,
	mapRepositoryBranchesToWorkspaceSources,
	mapStartableIssuesToWorkspaceSources,
	pullRequestSourceId,
	selectStartableIssues,
	selectStartedLinearIssues,
} from '@/renderer/lib/workbench';
import type {
	ProjectShellModel,
	WorkspaceSource,
	WorkspaceSourceItem,
	WorkspaceSourceKind,
} from '@/renderer/types/workbench';
import type { GithubFailure } from '@/shared/ipc/contracts/github';
import type { ListLinearIssuesResult } from '@/shared/ipc/contracts/linear';

/**
 * Result of the create-from picker's per-repository, per-tab data fetch.
 * `linearGap` is the localized reason the Issues tab may be missing Linear rows
 * — a failed read, or an organization that could not be reached — so an empty
 * tab is not taken for "nothing to start". `startedSources` are the Linear
 * issues somebody has already started, offered only while the Issues tab is
 * being searched, so the default list stays work nobody has picked up.
 */
interface WorkspaceSourcePickerState {
	error: GithubFailure | null;
	isLoading: boolean;
	itemsById: Map<string, WorkspaceSourceItem>;
	linearGap: string | null;
	sources: WorkspaceSource[];
	startedSources: WorkspaceSource[];
}

/** Separator for the linked-issue key signature; no Linear id or GitHub URL contains one. */
const LINKED_KEY_SEPARATOR = '\n';

/**
 * Fetches the create-from picker rows for one repository and the active tab,
 * lazily: only the query for `kind` runs, and only while the dialog is `open`.
 * Linear issues come from one global list, narrowed to the teams the
 * repository's committed `[linear]` block names when it names any; branches,
 * pull requests, and GitHub issues are scoped to `repoId`. The Issues tab lists
 * only work nobody has started — Linear issues in Backlog or Todo, and no issue
 * any of `projects`' workspaces is already linked to — ordered by priority, then
 * by last update, and reads as loading while the team scope loads or a Linear
 * refresh is running behind cached rows. A non-blank `query` on that tab also
 * reaches unlinked Linear issues already in progress, in the same team scope,
 * returned apart from the startable rows. Those come from the all-states browse
 * list, read only while the tab is searched, because the not-started list holds
 * none. Returns display sources plus a map back to the raw rows so a selection
 * can be turned into a creation seed.
 */
export function useWorkspaceSourcePicker({
	kind,
	open,
	projects,
	query,
	repoId,
}: {
	kind: WorkspaceSourceKind;
	open: boolean;
	projects: readonly ProjectShellModel[];
	query: string;
	repoId: string;
}): WorkspaceSourcePickerState {
	const hasRepo = repoId.length > 0;
	const reachesStartedIssues = kind === 'issue' && query.trim().length > 0;
	// The sidebar rebuilds `projects` on every render, so the memo keys on the
	// linked keys' content rather than the array's identity.
	const linkedIssueSignature =
		collectLinkedIssueKeys(projects).join(LINKED_KEY_SEPARATOR);
	const linkedIssueKeys = useMemo(
		() =>
			linkedIssueSignature
				? linkedIssueSignature.split(LINKED_KEY_SEPARATOR)
				: [],
		[linkedIssueSignature],
	);

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
		...linearIssuesQuery({ notStarted: true }),
		enabled: open,
	});
	const repository = projects.find((project) => project.id === repoId);
	const linearTeams = useQuery({
		...repositoryLinearTeamsQuery({
			repositoryId: repoId,
			repositoryPath: repository?.pathLabel ?? '',
		}),
		enabled: open && repository !== undefined,
	});
	// Only a search shows started issues, so their all-states sync waits for one.
	const browseLinearIssues = useQuery({
		...linearIssuesQuery({}),
		enabled: open && reachesStartedIssues,
	});
	const startedLinearResult = reachesStartedIssues
		? browseLinearIssues.data
		: undefined;
	const isStartedLinearLoading =
		reachesStartedIssues &&
		(browseLinearIssues.isLoading || isLinearSyncing(browseLinearIssues.data));

	const rows = useMemo<Omit<WorkspaceSourcePickerState, 'linearGap'>>(() => {
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
				startedSources: [],
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
				startedSources: [],
			};
		}

		const teams = linearTeams.data ?? [];
		const { githubIssues, linearIssues: linearIssueRows } =
			selectStartableIssues({
				githubIssues: githubIssuesQuery.data?.issues ?? [],
				linearIssues: (linearIssues.data?.issues ?? []).filter((issue) =>
					isLinearIssueInTeamScope(issue, teams),
				),
				linkedIssueKeys,
			});
		const startedLinearRows = selectStartedLinearIssues({
			linearIssues: (startedLinearResult?.issues ?? []).filter((issue) =>
				isLinearIssueInTeamScope(issue, teams),
			),
			linkedIssueKeys,
		});
		const itemsById = new Map<string, WorkspaceSourceItem>();
		for (const issue of githubIssues) {
			itemsById.set(githubIssueSourceId(issue.number), {
				issue,
				kind: 'github-issue',
			});
		}
		for (const issue of [...linearIssueRows, ...startedLinearRows]) {
			itemsById.set(issue.id, { issue, kind: 'linear-issue' });
		}
		return {
			error: errorOf(githubIssuesQuery.data),
			isLoading:
				githubIssuesQuery.isLoading ||
				linearIssues.isLoading ||
				linearTeams.isLoading ||
				isLinearSyncing(linearIssues.data) ||
				isStartedLinearLoading,
			itemsById,
			sources: mapStartableIssuesToWorkspaceSources({
				githubIssues,
				linearIssues: linearIssueRows,
			}),
			startedSources: mapLinearIssuesToWorkspaceSources(startedLinearRows),
		};
	}, [
		kind,
		startedLinearResult,
		isStartedLinearLoading,
		branchesQuery.data,
		branchesQuery.isLoading,
		pullRequestsQuery.data,
		pullRequestsQuery.isLoading,
		githubIssuesQuery.data,
		githubIssuesQuery.isLoading,
		linearIssues.data,
		linearIssues.isLoading,
		linearTeams.data,
		linearTeams.isLoading,
		linkedIssueKeys,
	]);

	return {
		...rows,
		linearGap:
			kind === 'issue'
				? (describeLinearListGap(linearIssues.data) ??
					describeLinearListGap(startedLinearResult))
				: null,
	};
}

/**
 * Whether a Linear list was answered from stale cached rows while its refresh
 * is still running. When the filter leaves none of those rows, the refresh may
 * still bring one it keeps — a Backlog or Todo issue, or a started one a search
 * reaches — so "nothing to start" or "no match" would be premature.
 * @param result - The Linear list answer, if one has arrived
 * @returns True while the refresh behind the answer is in flight
 */
function isLinearSyncing(result: ListLinearIssuesResult | undefined): boolean {
	return result?.status === 'ok' && result.syncing === true;
}

/**
 * Pulls the typed failure out of a degradable list result, else null. An `ok`
 * result carrying `staleError` counts: its rows came off the cache because the
 * refresh failed, and silently showing them makes a stale list look current.
 */
function errorOf(
	data:
		| {
				error?: GithubFailure;
				staleError?: GithubFailure;
				status: 'error' | 'ok';
		  }
		| undefined,
): GithubFailure | null {
	if (data?.status === 'error') {
		return data.error ?? null;
	}
	return data?.staleError ?? null;
}
