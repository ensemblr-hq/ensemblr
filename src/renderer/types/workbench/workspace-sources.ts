import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';
import type { WorkspaceLinkedIssueInput } from '@/shared/ipc/contracts/workspace';
import type {
	RepositoryBranchWire,
	RepositoryIssueWire,
	RepositoryPullRequestWire,
} from '@/shared/ipc/contracts/workspace-sources';

/** Optional provenance seed (e.g. from an issue, branch, or PR) for a workspace. */
export interface WorkspaceCreationSeed {
	/** Branch/PR sources fork the new workspace off this ref (e.g. `origin/x`). */
	baseBranch?: string;
	branchName?: string;
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
