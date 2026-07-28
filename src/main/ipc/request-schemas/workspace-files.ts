/**
 * Workspace-file attachment IPC request schemas.
 *
 * **Strict:** handlers call `schema.parse(raw)` inside a try/catch, so a
 * malformed renderer payload throws and is reported as a handled error.
 */
import { z } from 'zod';

/**
 * {@link import('../../../shared/ipc').WriteWorkspaceImageAttachmentRequest}.
 *
 * `contentBase64` is capped so an oversized paste is rejected before the handler
 * allocates the decoded buffer; ~20MB of base64 holds the 10MB decoded limit
 * (4/3 expansion) with margin for whitespace.
 */
export const writeWorkspaceImageAttachmentRequestSchema = z.object({
	contentBase64: z.string().min(1).max(20_000_000),
	mimeType: z.string().min(1).max(100),
	name: z.string().max(255).optional(),
	workspaceCwd: z.string().min(1),
});

/**
 * {@link import('../../../shared/ipc').WriteWorkspaceFileAttachmentRequest}.
 *
 * `contentBase64` is capped so an oversized paste is rejected before the handler
 * allocates the decoded buffer; ~70MB of base64 holds the 50MB decoded ceiling
 * (`HARD_MAX_ATTACHMENT_BYTES`, 4/3 expansion) with margin for whitespace.
 */
export const writeWorkspaceFileAttachmentRequestSchema = z.object({
	contentBase64: z.string().min(1).max(70_000_000),
	name: z.string().max(255).optional(),
	workspaceCwd: z.string().min(1),
});

/**
 * {@link import('../../../shared/ipc').WriteWorkspaceActionPromptRequest}. The
 * composed prompt is bounded well under the renderer's 24k review-context cap;
 * 200k characters leaves generous headroom without risking an unbounded write.
 */
export const writeWorkspaceActionPromptRequestSchema = z.object({
	action: z.string().min(1).max(64),
	content: z.string().min(1).max(200_000),
	workspaceCwd: z.string().min(1),
});
