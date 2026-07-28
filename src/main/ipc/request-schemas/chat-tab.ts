/**
 * Chat-tab IPC request schemas.
 *
 * **Strict:** handlers call `schema.parse(raw)`, so a malformed renderer
 * payload throws and surfaces as an IPC error in the renderer.
 */
import { z } from 'zod';
import {
	optionalNullableString,
	optionalStringCoerceNullToUndefined,
} from './primitives.ts';

/** {@link import('../../../shared/ipc').ListChatTabsRequest}. */
export const listChatTabsRequestSchema = z.object({
	workspaceId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').OpenChatTabRequest}. */
export const openChatTabRequestSchema = z.object({
	kind: z
		.enum(['chat', 'diff', 'document', 'file', 'preview', 'terminal'])
		.optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	piSessionId: optionalNullableString,
	title: optionalStringCoerceNullToUndefined,
	workspaceId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').CloseChatTabRequest}. */
export const closeChatTabRequestSchema = z.object({
	chatTabId: z.string().min(1),
	fullTitle: optionalStringCoerceNullToUndefined,
	metadataPatch: z
		.object({ agentSessionId: z.string().min(1).nullable().optional() })
		.optional(),
	title: optionalStringCoerceNullToUndefined,
});

/** {@link import('../../../shared/ipc').BindPiSessionToTabRequest}. */
export const bindPiSessionToChatTabRequestSchema = z.object({
	chatTabId: z.string().min(1),
	piSessionId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').RestoreChatTabRequest}. */
export const restoreChatTabRequestSchema = z.object({
	chatTabId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').ReorderChatTabsRequest}. */
export const reorderChatTabsRequestSchema = z.object({
	orderedIds: z.array(z.string().min(1)),
	workspaceId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').ListClosedChatTabsWithSummaryRequest}. */
export const listClosedChatTabsWithSummaryRequestSchema = z.object({
	workspaceId: z.string().min(1),
});
