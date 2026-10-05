import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
	linearIssuesQuery,
	repositoryBranchesQuery,
	repositoryIssuesQuery,
	repositoryLinearTeamsQuery,
	repositoryPullRequestsQuery,
} from '@/renderer/api/ensemblr';
import {
	type LinearAssigneeFilter,
	useLinearAssigneeFilter,
} from '@/renderer/hooks/linear/use-linear-assignee-filter';
import { githubIssueSourceId } from '@/renderer/lib/github';
import {
	describeLinearListGap,
	isLinearIssueInTeamScope,
	type LinearAssigneeOption,
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
import type {
	LinearIssueWire,
	ListLinearIssuesResult,
} from '@/shared/ipc/contracts/linear';

/**
 * Result of the create-from picker's per-repository, per-tab data fetch.
 * `linearGap` is the localized reason the Issues tab may be missing Linear rows
 * — a failed read, or an organization that could not be reached — so an empty
 * tab is not taken for "nothing to start". `startedSources` are the Linear
 * issues somebody has already started, offered only while the Issues tab is
 * being searched, so the default list stays work nobody has picked up.
 * `assigneeOptions` are the people the Issues tab's assignee facet offers, or
 * null while no Linear account is connected and the facet has nothing to do.
 */
interface WorkspaceSourcePickerState {
	assigneeOptions: LinearAssigneeOption[] | null;
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
 * returned apart from the startable rows. Those come from the started list,
 * synced with its own state-filtered query and read only while the tab is
 * searched. `linearAssignees` narrows both Linear lists by assignee; GitHub
 * rows are left alone. Returns display sources plus a map back to the raw rows
 * so a selection can be turned into a creation seed.
 */
export function useWorkspaceSourcePicker({
	kind,
	linearAssignees,
	open,
	projects,
	query,
	repoId,
}: {
	kind: WorkspaceSourceKind;
	linearAssignees: readonly string[];
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
		...linearIssuesQuery({ stateScope: 'not-started' }),
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
	// Only a search shows started issues, so their sync waits for one.
	const startedLinearIssues = useQuery({
		...linearIssuesQuery({ stateScope: 'started' }),
		enabled: open && reachesStartedIssues,
	});
	const startedLinearResult = reachesStartedIssues
		? startedLinearIssues.data
		: undefined;
	const isStartedLinearLoading =
		reachesStartedIssues &&
		(startedLinearIssues.isLoading ||
			isLinearSyncing(startedLinearIssues.data));
	const {
		assignee,
		started: scopedStartedLinearIssues,
		startable: scopedLinearIssues,
	} = useScopedLinearIssues({
		selection: linearAssignees,
		startable: linearIssues.data,
		started: startedLinearResult,
		teams: linearTeams.data,
	});

	const rows = useMemo<
		Omit<WorkspaceSourcePickerState, 'assigneeOptions' | 'linearGap'>
	>(() => {
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

		const { githubIssues, linearIssues: linearIssueRows } =
			selectStartableIssues({
				githubIssues: githubIssuesQuery.data?.issues ?? [],
				linearIssues: scopedLinearIssues.filter(assignee.matches),
				linkedIssueKeys,
			});
		const startedLinearRows = selectStartedLinearIssues({
			linearIssues: scopedStartedLinearIssues.filter(assignee.matches),
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
		assignee.matches,
		scopedLinearIssues,
		scopedStartedLinearIssues,
		isStartedLinearLoading,
		branchesQuery.data,
		branchesQuery.isLoading,
		pullRequestsQuery.data,
		pullRequestsQuery.isLoading,
		githubIssuesQuery.data,
		githubIssuesQuery.isLoading,
		linearIssues.data,
		linearIssues.isLoading,
		linearTeams.isLoading,
		linkedIssueKeys,
	]);

	return {
		...rows,
		assigneeOptions: assignee.options,
		linearGap:
			kind === 'issue'
				? issuesTabLinearGap(linearIssues.data, startedLinearResult)
				: null,
	};
}

/**
 * Why the Issues tab may be missing Linear rows, from whichever of its two
 * Linear answers names a gap first.
 * @param startable - The Backlog and Todo answer, if one has arrived
 * @param started - The in-progress answer a search reaches, if read
 * @returns The localized reason, or null when neither list is short
 */
function issuesTabLinearGap(
	startable: ListLinearIssuesResult | undefined,
	started: ListLinearIssuesResult | undefined,
): string | null {
	return describeLinearListGap(startable) ?? describeLinearListGap(started);
}

/**
 * Narrows the Issues tab's two Linear answers to the repository's team scope,
 * and resolves the assignee facet over both, so its options cover the started
 * rows a search reaches as well as the startable ones.
 * @param lists - The startable and started answers, the repository's teams, and the facet's selection
 * @returns The in-scope rows of each list, and the facet's predicate and options
 */
function useScopedLinearIssues({
	selection,
	startable,
	started,
	teams,
}: {
	selection: readonly string[];
	startable: ListLinearIssuesResult | undefined;
	started: ListLinearIssuesResult | undefined;
	teams: readonly string[] | undefined;
}): {
	assignee: LinearAssigneeFilter;
	startable: LinearIssueWire[];
	started: LinearIssueWire[];
} {
	const scopedStartable = useMemo(
		() => inTeamScope(startable, teams),
		[startable, teams],
	);
	const scopedStarted = useMemo(
		() => inTeamScope(started, teams),
		[started, teams],
	);
	const issues = useMemo(
		() => [...scopedStartable, ...scopedStarted],
		[scopedStartable, scopedStarted],
	);
	const assignee = useLinearAssigneeFilter({ issues, selection });

	return { assignee, startable: scopedStartable, started: scopedStarted };
}

/**
 * The Linear rows of one list answer that fall inside the repository's team
 * scope.
 * @param result - The Linear list answer, if one has arrived
 * @param teams - The team keys and ids the repository names, if loaded
 * @returns The in-scope issues, empty until the answer arrives
 */
function inTeamScope(
	result: ListLinearIssuesResult | undefined,
	teams: readonly string[] | undefined,
): LinearIssueWire[] {
	return (result?.issues ?? []).filter((issue) =>
		isLinearIssueInTeamScope(issue, teams ?? []),
	);
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
