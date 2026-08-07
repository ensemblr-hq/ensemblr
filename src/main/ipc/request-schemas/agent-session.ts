/**
 * Agent-session IPC request schemas.
 *
 * **Strict:** all renderer-facing agent session IPC payloads validate here.
 * Handlers already wrap calls in try/catch and surface failures as
 * `{ error }`, so a Zod parse error becomes a controlled error response rather
 * than an unhandled rejection.
 */
import { z } from 'zod';
import { optionalNullableString } from './primitives.ts';

/** {@link import('../../../shared/ipc').OpenAgentSessionRequest}. */
export const openAgentSessionRequestSchema = z.object({
	chatTabId: optionalNullableString,
	initialPrompt: optionalNullableString,
	label: z.string().optional(),
	model: optionalNullableString,
	planMode: z.boolean().optional(),
	resumeSessionId: optionalNullableString,
	thinkingLevel: optionalNullableString,
	workspaceCwd: z.string(),
	workspaceId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').SubmitAgentPromptRequest}. */
export const submitAgentPromptRequestSchema = z.object({
	model: optionalNullableString,
	planMode: z.boolean().optional(),
	prompt: z.string(),
	sessionId: z.string().min(1),
	streamingBehavior: z.enum(['steer', 'followUp']).optional(),
	thinkingLevel: optionalNullableString,
});

/** {@link import('../../../shared/ipc').StopAgentSessionRequest}. */
export const stopAgentSessionRequestSchema = z.object({
	reason: z.string().optional(),
	sessionId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').ListAgentSessionsRequest}. */
export const listAgentSessionsRequestSchema = z.object({
	workspaceId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').ListAgentSessionEventsRequest}. */
export const listAgentSessionEventsRequestSchema = z.object({
	branchId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').WriteForkSummaryRequest}. */
export const writeForkSummaryRequestSchema = z.object({
	branchId: z.string().min(1),
	fileBaseName: z.string().min(1),
	sessionId: z.string().min(1),
	targetWorkspaceCwd: z.string().min(1).optional(),
	upToOrdinal: z.number().int().nonnegative().optional(),
});
