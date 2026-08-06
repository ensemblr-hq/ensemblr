import { buildWorkspaceSeedFromGithubIssue } from '@/renderer/lib/github';
import { buildWorkspaceSeedFromLinearIssue } from '@/renderer/lib/linear';
import type {
	WorkspaceCreationSeed,
	WorkspaceSource,
	WorkspaceSourceActionId,
	WorkspaceSourceItem,
} from '@/renderer/types/workbench';
import { originQualifiedRef } from '@/shared/branch-ref';
import type {
	RepositoryBranchWire,
	RepositoryPullRequestWire,
} from '@/shared/ipc/contracts/workspace-sources';

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
 * Builds the workspace creation seed for a selected picker item.
 *
 * A branch or pull request hands the workspace that branch outright, so its
 * commits show up in the review panel and pushes land on the pull request the
 * branch already backs. `duplicate-branch` is the deliberate exception: it forks
 * a copy off the branch tip instead. Neither one sets the branch as the base —
 * that stays the branch being merged *into*, defaulting to the repository's
 * configured target when the source does not name one. Issue sources cut a fresh
 * branch and attach the linked issue + composer context.
 * @param item - The picker row the user selected.
 * @param actionId - Which of the row's actions was invoked.
 * @returns The seed to send with the create-workspace request.
 */
export function workspaceSeedFromSourceItem(
	item: WorkspaceSourceItem,
	actionId: WorkspaceSourceActionId,
): WorkspaceCreationSeed {
	switch (item.kind) {
		case 'branch':
			return actionId === 'duplicate-branch'
				? {
						branchPlan: {
							forkRef: `origin/${item.branch.name}`,
							kind: 'create',
						},
					}
				: {
						branchPlan: { branch: item.branch.name, kind: 'adopt' },
						name: item.branch.name,
					};
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
						name: item.pullRequest.title,
					};
		}
		case 'linear-issue':
			return buildWorkspaceSeedFromLinearIssue(item.issue);
		case 'github-issue':
			return buildWorkspaceSeedFromGithubIssue(item.issue);
	}
}
