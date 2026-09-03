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

/** {@link import('../../../shared/ipc').ListAllChatTabsRequest}. */
export const listAllChatTabsRequestSchema = z.object({
	closedLimit: z.number().int().positive().max(500).optional(),
});

/** {@link import('../../../shared/ipc').ListChatTabsRequest}. */
export const listChatTabsRequestSchema = z.object({
	workspaceId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').OpenChatTabRequest}. */
export const openChatTabRequestSchema = z.object({
	insertAfterChatTabId: optionalNullableString,
	kind: z
		.enum(['chat', 'diff', 'document', 'file', 'preview', 'terminal'])
		.optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	agentSessionId: optionalNullableString,
	preview: z.boolean().optional(),
	title: optionalStringCoerceNullToUndefined,
	workspaceId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').PinChatTabRequest}. */
export const pinChatTabRequestSchema = z.object({
	chatTabId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').CloseChatTabRequest}. */
export const closeChatTabRequestSchema = z.object({
	chatTabId: z.string().min(1),
	fullTitle: optionalStringCoerceNullToUndefined,
	metadataPatch: z
		.object({ harnessSessionId: z.string().min(1).nullable().optional() })
		.optional(),
	title: optionalStringCoerceNullToUndefined,
});

/** {@link import('../../../shared/ipc').BindAgentSessionToTabRequest}. */
export const bindAgentSessionToChatTabRequestSchema = z.object({
	chatTabId: z.string().min(1),
	agentSessionId: z.string().min(1),
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

/** {@link import('../../../shared/ipc').ListChatTabSummariesRequest}. */
export const listChatTabSummariesRequestSchema = z.object({
	workspaceId: z.string().min(1),
});
