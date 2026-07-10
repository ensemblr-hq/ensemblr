import type { WorkspaceLinkedIssueInput } from '@/shared/ipc/contracts/workspace';

/** Workspace creation seed derived from a GitHub issue. */
export interface GithubIssueWorkspaceSeed {
	linkedIssue: WorkspaceLinkedIssueInput;
}
