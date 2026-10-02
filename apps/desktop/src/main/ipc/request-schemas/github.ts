/**
 * GitHub commit, push, and pull-request IPC request schemas.
 *
 * **Strict:** handlers call `schema.parse(raw)`. These payloads carry
 * renderer-supplied filesystem paths that ultimately reach `git`/`gh`
 * invocations, so they must be validated at the boundary.
 */
import { z } from 'zod';

/** {@link import('../../../shared/ipc').CommitWorkspaceChangesRequest}. */
export const commitWorkspaceChangesRequestSchema = z.object({
	message: z.string().min(1),
	paths: z.array(z.string().min(1)).optional(),
	workspaceCwd: z.string().min(1),
});

/** {@link import('../../../shared/ipc').PushWorkspaceBranchRequest}. */
export const pushWorkspaceBranchRequestSchema = z.object({
	setUpstream: z.boolean().optional(),
	workspaceCwd: z.string().min(1),
});

/** {@link import('../../../shared/ipc').CreatePullRequestRequest}. */
export const createPullRequestRequestSchema = z.object({
	baseBranch: z.string().min(1).optional(),
	body: z.string(),
	draft: z.boolean().optional(),
	title: z.string().min(1),
	workspaceCwd: z.string().min(1),
});

/** {@link import('../../../shared/ipc').GetPullRequestSnapshotRequest}. */
export const getPullRequestSnapshotRequestSchema = z.object({
	refresh: z.boolean().optional(),
	workspaceCwd: z.string().min(1),
	workspaceId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').MergePullRequestRequest}. */
export const mergePullRequestRequestSchema = z.object({
	method: z.enum(['merge', 'rebase', 'squash']).optional(),
	workspaceCwd: z.string().min(1),
	workspaceId: z.string().min(1),
});

/**
 * {@link import('../../../shared/ipc/contracts/workspace-sources').ListRepositoryBranchesRequest}
 * and its PR sibling — both just a repository id.
 */
export const listRepositorySourcesRequestSchema = z.object({
	repositoryId: z.string().min(1),
});

/**
 * {@link import('../../../shared/ipc/contracts/workspace-sources').ListRepositoryIssuesRequest}
 * — a repository id, the flag that bypasses the persisted issue cache, and the
 * flag that narrows the list to unassigned issues for the dashboard board.
 */
export const listRepositoryIssuesRequestSchema =
	listRepositorySourcesRequestSchema.extend({
		refresh: z.boolean().optional(),
		unassignedOnly: z.boolean().optional(),
	});
