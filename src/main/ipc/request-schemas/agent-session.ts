/**
 * Agent-session IPC request schemas.
 *
 * **Strict:** all renderer-facing agent session IPC payloads validate here.
 * Handlers already wrap calls in try/catch and surface failures as
 * `{ error }`, so a Zod parse error becomes a controlled error response rather
 * than an unhandled rejection.
 */
import path from 'node:path';
import { z } from 'zod';
import { optionalNullableString } from './primitives.ts';

/**
 * Ceiling on how many directories one session may be granted. Well past any
 * plausible manual set, low enough that a corrupted payload cannot hand the
 * runtime a launch argument list of unbounded length.
 */
const MAX_LINKED_DIRECTORIES = 64;

/**
 * Absolute paths outside the workspace a session is granted read access to.
 * Validated here rather than downstream because this is the only gate: unlike
 * {@link import('./linked-directories.ts').linkedDirectoryRequestSchema}, whose
 * payload the linked-directory service then checks, these paths go straight into
 * the runtime's sandbox allowlist. They arrive from a `localStorage`-backed atom,
 * so a relative or empty segment reaching the adapter is a real shape.
 */
const linkedDirectoriesSchema = z
	.array(
		z
			.string()
			.min(1)
			.max(4096)
			.refine((value) => path.isAbsolute(value), {
				message: 'A linked directory needs an absolute path.',
			}),
	)
	.max(MAX_LINKED_DIRECTORIES);

/** {@link import('../../../shared/ipc').OpenAgentSessionRequest}. */
export const openAgentSessionRequestSchema = z.object({
	afkMode: z.boolean().optional(),
	chatTabId: optionalNullableString,
	initialPrompt: optionalNullableString,
	label: z.string().optional(),
	linkedDirectories: linkedDirectoriesSchema.optional(),
	model: optionalNullableString,
	planMode: z.boolean().optional(),
	resumeSessionId: optionalNullableString,
	thinkingLevel: optionalNullableString,
	workspaceCwd: z.string(),
	workspaceId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').SubmitAgentPromptRequest}. */
export const submitAgentPromptRequestSchema = z.object({
	afkMode: z.boolean().optional(),
	model: optionalNullableString,
	planMode: z.boolean().optional(),
	prompt: z.string(),
	sessionId: z.string().min(1),
	streamingBehavior: z.enum(['steer', 'followUp']).optional(),
	thinkingLevel: optionalNullableString,
});

/** {@link import('../../../shared/ipc').SetAgentPlanModeRequest}. */
export const setAgentPlanModeRequestSchema = z.object({
	planMode: z.boolean(),
	sessionId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').RefreshAgentPlanUsageRequest}. */
export const refreshAgentPlanUsageRequestSchema = z.object({
	sessionId: z.string().min(1),
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
