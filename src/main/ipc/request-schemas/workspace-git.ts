/**
 * Workspace git status, diff, commit-log, and discard IPC request schemas.
 *
 * **Strict:** handlers call `schema.parse(raw)`, so a malformed renderer
 * payload throws and surfaces as an IPC error in the renderer.
 */
import { z } from 'zod';

/**
 * A git ref (branch name, tag, etc.) that reaches `git` directly: restricted to
 * safe ref characters and never starting with `-` (which git reads as a flag).
 */
const gitRefSchema = z
	.string()
	.min(1)
	.max(255)
	.regex(/^(?!-)[\w./@+~^-]+$/);

/**
 * {@link import('../../../shared/ipc').WorkspaceGitDiffScope}. The commit hash also
 * reaches `git` directly, so it is restricted to hex characters.
 */
const workspaceGitDiffScopeSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('working-tree') }),
	z.object({
		commitHash: z.string().regex(/^[0-9a-fA-F]{4,40}$/),
		kind: z.literal('commit'),
	}),
	z.object({
		baseRef: gitRefSchema,
		kind: z.literal('branch'),
	}),
]);

/** {@link import('../../../shared/ipc').GetWorkspaceGitStatusRequest}. */
export const getWorkspaceGitStatusRequestSchema = z.object({
	scope: workspaceGitDiffScopeSchema.optional(),
	workspaceCwd: z.string().min(1),
});

/** {@link import('../../../shared/ipc').GetWorkspaceFileDiffRequest}. */
export const getWorkspaceFileDiffRequestSchema = z.object({
	path: z.string().min(1),
	scope: workspaceGitDiffScopeSchema.optional(),
	workspaceCwd: z.string().min(1),
});

/** {@link import('../../../shared/ipc').GetWorkspaceMergeConflictsRequest}. */
export const getWorkspaceMergeConflictsRequestSchema = z.object({
	baseRef: gitRefSchema,
	workspaceCwd: z.string().min(1),
});

/** {@link import('../../../shared/ipc').GetWorkspaceCommitsRequest}. */
export const getWorkspaceCommitsRequestSchema = z.object({
	baseRef: gitRefSchema.optional(),
	limit: z.number().int().positive().max(100).optional(),
	workspaceCwd: z.string().min(1),
});

/** {@link import('../../../shared/ipc').DiscardWorkspaceChangesRequest}. */
export const discardWorkspaceChangesRequestSchema = z.object({
	paths: z.array(z.string().min(1)).min(1).max(1000),
	workspaceCwd: z.string().min(1),
});
