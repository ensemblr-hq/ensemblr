import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';
import type {
	WorkspaceBranchPlan,
	WorkspaceLinkedIssueInput,
} from '@/shared/ipc/contracts/workspace';
import type {
	RepositoryBranchWire,
	RepositoryIssueWire,
	RepositoryPullRequestWire,
} from '@/shared/ipc/contracts/workspace-sources';

/** Optional provenance seed (e.g. from an issue, branch, or PR) for a workspace. */
export interface WorkspaceCreationSeed {
	/** Branch the workspace merges into and diffs against (e.g. `origin/main`). */
	baseBranch?: string;
	branchName?: string;
	/** How the workspace's branch comes into being; defaults to cutting a new one. */
	branchPlan?: WorkspaceBranchPlan;
	linkedIssue?: WorkspaceLinkedIssueInput;
	name?: string;
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
