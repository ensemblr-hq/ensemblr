/**
 * Review comment and todo IPC request schemas.
 *
 * **Strict:** handlers call `schema.parse(raw)`, so a malformed renderer
 * payload throws and surfaces as an IPC error in the renderer.
 */
import { z } from 'zod';

/** {@link import('../../../shared/ipc').ListReviewCommentsRequest} and {@link import('../../../shared/ipc').ListReviewTodosRequest}. */
export const reviewListRequestSchema = z.object({
	workspaceId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').DeleteReviewCommentRequest} and {@link import('../../../shared/ipc').DeleteReviewTodoRequest}. */
export const reviewDeleteRequestSchema = z.object({ id: z.string().min(1) });

/** {@link import('../../../shared/ipc').SaveReviewCommentRequest}. */
export const saveReviewCommentRequestSchema = z.object({
	body: z.string().optional(),
	filePath: z.string().optional(),
	id: z.string().optional(),
	lineNumber: z.number().int().nullable().optional(),
	status: z.enum(['archived', 'open', 'resolved']).optional(),
	workspaceId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').SaveReviewTodoRequest}. */
export const saveReviewTodoRequestSchema = z.object({
	id: z.string().optional(),
	status: z.enum(['canceled', 'done', 'in_progress', 'open']).optional(),
	title: z.string().optional(),
	workspaceId: z.string().min(1),
});
