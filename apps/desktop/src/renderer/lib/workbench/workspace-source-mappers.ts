import {
	buildWorkspaceSeedFromGithubIssue,
	mapGithubIssuesToWorkspaceSources,
} from '@/renderer/lib/github';
import {
	buildWorkspaceSeedFromLinearIssue,
	compareByPriorityThenRecency,
	isLinearIssueNotStarted,
	isLinearIssueStarted,
	mapLinearIssuesToWorkspaceSources,
} from '@/renderer/lib/linear';
import type {
	ProjectShellModel,
	WorkspaceCreationSeed,
	WorkspaceSource,
	WorkspaceSourceActionId,
	WorkspaceSourceItem,
} from '@/renderer/types/workbench';
import { originQualifiedRef } from '@/shared/branch-ref';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';
import type {
	RepositoryBranchWire,
	RepositoryIssueWire,
	RepositoryPullRequestWire,
} from '@/shared/ipc/contracts/workspace-sources';
import { toWorkspaceDisplayName } from '@/shared/workspace-name';

/** The issue rows the create-from picker's Issues tab offers, per provider. */
interface StartableIssues {
	githubIssues: RepositoryIssueWire[];
	linearIssues: LinearIssueWire[];
}

/** A picker row paired with the priority and last-update time it sorts by. */
interface RankedIssueSource {
	rank: Pick<LinearIssueWire, 'priority' | 'updatedAt'>;
	source: WorkspaceSource;
}

/** Stable picker-row id for a branch source. */
export function branchSourceId(name: string): string {
	return `branch:${name}`;
}

/** Stable picker-row id for a pull-request source. */
export function pullRequestSourceId(prNumber: number): string {
	return `pr:${prNumber}`;
}

/** Maps GitHub branches into create-from picker sources. */
export function mapRepositoryBranchesToWorkspaceSources(
	branches: RepositoryBranchWire[],
): WorkspaceSource[] {
	return branches.map((branch) => ({
		hasWorkspace: branch.hasWorkspace,
		id: branchSourceId(branch.name),
		isDefaultBranch: branch.isDefault,
		kind: 'branch',
		provider: 'github',
		title: branch.name,
	}));
}

/** Maps open pull requests into create-from picker sources. */
export function mapPullRequestsToWorkspaceSources(
	pullRequests: RepositoryPullRequestWire[],
): WorkspaceSource[] {
	return pullRequests.map((pullRequest) => ({
		hasWorkspace: pullRequest.hasWorkspace,
		id: pullRequestSourceId(pullRequest.number),
		kind: 'pull-request',
		provider: 'github',
		reference: `#${pullRequest.number}`,
		subtitle: pullRequest.headRefName,
		title: pullRequest.title,
	}));
}

/**
 * Collects every workspace's linked-issue key, so an issue that already
 * produced a workspace is not offered as a fresh start a second time.
 * @param projects - The projects whose workspaces to read.
 * @returns The remote issue ids, which are Linear issue ids and GitHub issue URLs.
 */
export function collectLinkedIssueKeys(
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
 * Narrows the create-from picker's issue rows to work nobody has started:
 * Linear issues still in Backlog or Todo, minus any issue that already produced
 * a workspace. GitHub rows need no state test because `gh` lists open issues
 * only, and they keep their assignees — an issue assigned to the user is one
 * they would start from.
 * @param input - Both providers' cached rows, plus every workspace's linked-issue key.
 * @returns The rows the picker should list, per provider, in their original order.
 */
export function selectStartableIssues({
	githubIssues,
	linearIssues,
	linkedIssueKeys,
}: {
	githubIssues: readonly RepositoryIssueWire[];
	linearIssues: readonly LinearIssueWire[];
	linkedIssueKeys: readonly string[];
}): StartableIssues {
	const linked = new Set(linkedIssueKeys);
	return {
		githubIssues: githubIssues.filter((issue) => !linked.has(issue.url)),
		linearIssues: linearIssues.filter(
			(issue) => isLinearIssueNotStarted(issue) && !linked.has(issue.id),
		),
	};
}

/**
 * Maps the Issues tab's rows into picker sources, both providers in one list
 * ordered by Linear priority (urgent first, "no priority" last), then by last
 * update, newest first. GitHub has no priority, so its issues rank as "no
 * priority" and interleave with unprioritized Linear issues by recency. Rows
 * that tie keep their incoming order, GitHub ahead of Linear.
 * @param issues - The startable rows per provider, as {@link selectStartableIssues} returns them.
 * @returns The ordered picker sources.
 */
export function mapStartableIssuesToWorkspaceSources({
	githubIssues,
	linearIssues,
}: StartableIssues): WorkspaceSource[] {
	const githubSources = mapGithubIssuesToWorkspaceSources(githubIssues);
	const linearSources = mapLinearIssuesToWorkspaceSources(linearIssues);
	const ranked: RankedIssueSource[] = [
		...githubIssues.map((issue, index) => ({
			rank: { priority: null, updatedAt: issue.updatedAt },
			source: githubSources[index],
		})),
		...linearIssues.map((issue, index) => ({
			rank: issue,
			source: linearSources[index],
		})),
	];
	return ranked
		.sort((left, right) => compareByPriorityThenRecency(left.rank, right.rank))
		.map(({ source }) => source);
}

/**
 * Narrows Linear rows to work somebody has already started — In Progress, In
 * Review — that no workspace is linked to, so a search in the create-from
 * picker can reach a teammate's started ticket. Done and canceled issues stay
 * out, and so does an issue that already produced a workspace here. The rows
 * follow the startable list's order: priority, then last update.
 * @param input - The cached Linear rows, plus every workspace's linked-issue key.
 * @returns The started rows, most urgent and most recently updated first.
 */
export function selectStartedLinearIssues({
	linearIssues,
	linkedIssueKeys,
}: {
	linearIssues: readonly LinearIssueWire[];
	linkedIssueKeys: readonly string[];
}): LinearIssueWire[] {
	const linked = new Set(linkedIssueKeys);
	return linearIssues
		.filter((issue) => isLinearIssueStarted(issue) && !linked.has(issue.id))
		.sort(compareByPriorityThenRecency);
}

/**
 * The active workspace already holding a source's branch, when the user picked
 * the `open` action. Branch and pull-request rows both carry that ownership;
 * issue sources never do, so they always create.
 * @param item - The picker row the user selected.
 * @param actionId - Which of the row's actions was invoked.
 * @returns The workspace id to navigate to, or null when the row should create.
 */
export function openableWorkspaceId(
	item: WorkspaceSourceItem,
	actionId: WorkspaceSourceActionId,
): string | null {
	if (actionId !== 'open') {
		return null;
	}
	switch (item.kind) {
		case 'branch':
			return item.branch.workspaceId;
		case 'pull-request':
			return item.pullRequest.workspaceId;
		case 'linear-issue':
		case 'github-issue':
			return null;
	}
}

/**
 * The `name` fragment to spread into a seed, sanitized from a source's own
 * label. Omitted entirely when nothing usable survives, which leaves the
 * workspace on the generated-placeholder path rather than failing creation.
 * @param label - The source's raw label: a branch name or pull-request title.
 * @returns A spreadable `{ name }`, or an empty object.
 */
function displayName(label: string): { name?: string } {
	const name = toWorkspaceDisplayName(label);
	return name ? { name } : {};
}

/**
 * Builds the workspace creation seed for a selected picker item.
 *
 * A branch or pull request hands the workspace that branch outright, so its
 * commits show up in the review panel and pushes land on the pull request the
 * branch already backs. Neither one sets the branch as the base — that stays the
 * branch being merged *into*, defaulting to the repository's configured target
 * when the source does not name one.
 *
 * Two cases fork instead. `duplicate-branch` is the explicit one. The default
 * branch is the implicit one: the repository folder already has it checked out,
 * and git allows a branch in a single worktree, so taking it over could only
 * fail — picking it means "start something new off master", which also makes it
 * the merge target. Issue sources cut a fresh branch and attach the linked issue
 * + composer context.
 * @param item - The picker row the user selected.
 * @param actionId - Which of the row's actions was invoked.
 * @returns The seed to send with the create-workspace request.
 */
export function workspaceSeedFromSourceItem(
	item: WorkspaceSourceItem,
	actionId: WorkspaceSourceActionId,
): WorkspaceCreationSeed {
	switch (item.kind) {
		case 'branch': {
			const tip = `origin/${item.branch.name}`;
			if (item.branch.isDefault) {
				return {
					baseBranch: tip,
					branchPlan: { forkRef: tip, kind: 'create' },
				};
			}
			return actionId === 'duplicate-branch'
				? { branchPlan: { forkRef: tip, kind: 'create' } }
				: {
						branchPlan: { branch: item.branch.name, kind: 'adopt' },
						...displayName(item.branch.name),
					};
		}
		case 'pull-request': {
			const target = originQualifiedRef(item.pullRequest.baseRefName);
			const base = target ? { baseBranch: target } : {};
			return actionId === 'duplicate-branch'
				? {
						...base,
						branchPlan: {
							forkRef: `origin/${item.pullRequest.headRefName}`,
							kind: 'create',
						},
					}
				: {
						...base,
						branchPlan: {
							branch: item.pullRequest.headRefName,
							kind: 'adopt',
						},
						...displayName(item.pullRequest.title),
					};
		}
		case 'linear-issue':
			return buildWorkspaceSeedFromLinearIssue(item.issue);
		case 'github-issue':
			return buildWorkspaceSeedFromGithubIssue(item.issue);
	}
}
