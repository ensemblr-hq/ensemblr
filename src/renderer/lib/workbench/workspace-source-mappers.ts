import type { WorkspaceCreationSeed } from '@/renderer/hooks/workbench-shell/navigation-sidebar/use-project-navigation-actions';
import {
	buildWorkspaceSeedFromGithubIssue,
	githubIssueSourceId,
} from '@/renderer/lib/github';
import { buildWorkspaceSeedFromLinearIssue } from '@/renderer/lib/linear';
import type { WorkspaceSource } from '@/renderer/types/workbench';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';
import type {
	RepositoryBranchWire,
	RepositoryIssueWire,
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

export { githubIssueSourceId };

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
		id: pullRequestSourceId(pullRequest.number),
		kind: 'pull-request',
		provider: 'github',
		reference: `#${pullRequest.number}`,
		subtitle: pullRequest.headRefName,
		title: pullRequest.title,
	}));
}

/**
 * The raw row behind a picker source, retained so a selection can become a
 * workspace creation seed (or, for a branch that already has a workspace, an
 * open-existing navigation).
 */
export type WorkspaceSourceItem =
	| { branch: RepositoryBranchWire; kind: 'branch' }
	| { issue: LinearIssueWire; kind: 'linear-issue' }
	| { issue: RepositoryIssueWire; kind: 'github-issue' }
	| { kind: 'pull-request'; pullRequest: RepositoryPullRequestWire };

/**
 * Builds the workspace creation seed for a selected picker item. Branch/PR
 * sources fork off the source tip (`baseBranch`); issue sources fork off the
 * repository default and attach the linked issue + composer context.
 */
export function workspaceSeedFromSourceItem(
	item: WorkspaceSourceItem,
): WorkspaceCreationSeed {
	switch (item.kind) {
		case 'branch':
			return { baseBranch: `origin/${item.branch.name}` };
		case 'pull-request':
			return { baseBranch: `origin/${item.pullRequest.headRefName}` };
		case 'linear-issue':
			return buildWorkspaceSeedFromLinearIssue(item.issue);
		case 'github-issue':
			return buildWorkspaceSeedFromGithubIssue(item.issue);
	}
}
