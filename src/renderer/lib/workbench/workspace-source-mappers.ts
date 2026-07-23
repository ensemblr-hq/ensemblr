import { buildWorkspaceSeedFromGithubIssue } from '@/renderer/lib/github';
import { buildWorkspaceSeedFromLinearIssue } from '@/renderer/lib/linear';
import type {
	WorkspaceCreationSeed,
	WorkspaceSource,
	WorkspaceSourceItem,
} from '@/renderer/types/workbench';
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
		id: pullRequestSourceId(pullRequest.number),
		kind: 'pull-request',
		provider: 'github',
		reference: `#${pullRequest.number}`,
		subtitle: pullRequest.headRefName,
		title: pullRequest.title,
	}));
}

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
