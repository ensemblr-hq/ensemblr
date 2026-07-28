/**
 * Pi-session IPC request schemas.
 *
 * **Strict:** all renderer-facing Pi session IPC payloads validate here.
 * Handlers already wrap calls in try/catch and surface failures as
 * `{ error }`, so a Zod parse error becomes a controlled error response rather
 * than an unhandled rejection.
 */
import { z } from 'zod';
import { optionalNullableString } from './primitives.ts';

/** {@link import('../../../shared/ipc').OpenPiSessionRequest}. */
export const openPiSessionRequestSchema = z.object({
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

/** {@link import('../../../shared/ipc').SubmitPiPromptRequest}. */
export const submitPiPromptRequestSchema = z.object({
	model: optionalNullableString,
	planMode: z.boolean().optional(),
	prompt: z.string(),
	sessionId: z.string().min(1),
	streamingBehavior: z.enum(['steer', 'followUp']).optional(),
	thinkingLevel: optionalNullableString,
});

/** {@link import('../../../shared/ipc').StopPiSessionRequest}. */
export const stopPiSessionRequestSchema = z.object({
	reason: z.string().optional(),
	sessionId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').ListPiSessionsRequest}. */
export const listPiSessionsRequestSchema = z.object({
	workspaceId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').ListPiSessionEventsRequest}. */
export const listPiSessionEventsRequestSchema = z.object({
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

/** {@link import('../../../shared/ipc').SetPiExecutablePathRequest}. */
export const setPiExecutablePathRequestSchema = z.object({
	path: z.string().min(1),
});

/**
 * Parses a set-Pi-executable-path payload, returning `null` on malformed input
 * so the handler can surface a clean selection error instead of throwing a
 * `TypeError` when the renderer sends `undefined` or a non-string `path`.
 * @param raw - Raw IPC payload.
 * @returns The validated request, or `null` when the payload is malformed.
 */
export function parseSetPiExecutablePathRequest(
	raw: unknown,
): z.infer<typeof setPiExecutablePathRequestSchema> | null {
	const parsed = setPiExecutablePathRequestSchema.safeParse(raw);

	return parsed.success ? parsed.data : null;
}
