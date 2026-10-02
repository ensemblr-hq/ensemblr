/**
 * Terminal IPC request schemas.
 *
 * **Lenient:** the terminal handlers historically forwarded their payload to
 * the service unvalidated, so this narrows the one field that reaches the
 * filesystem and leaves every other field's existing handling alone — a
 * malformed `restoredFromId` is dropped rather than failing the create. The
 * password-prompt answer is lenient too: a malformed one is reported back as
 * not answered rather than thrown, so the field can say so.
 */
import { z } from 'zod';

import type { CreateTerminalSessionRequest } from '../../../shared/ipc/contracts/terminal';

/**
 * Longest password-prompt answer accepted. Far past any real password, and far
 * below the PTY write cap, so the answer is never cut short on its way in.
 */
const MAX_SECRET_ANSWER_LENGTH = 1024;

/**
 * Answer to a setup or run script's password prompt. Refuses an empty answer
 * and one carrying a line break: main appends the single Enter the prompt
 * reads, so a second one would hand the rest of the value to whatever reads
 * stdin after the prompt.
 */
export const answerTerminalSecretPromptRequestSchema = z.object({
	answer: z
		.string()
		.min(1)
		.max(MAX_SECRET_ANSWER_LENGTH)
		.refine((value) => !/[\r\n]/.test(value), {
			message: 'A password answer must be a single line.',
		}),
	terminalId: z.string().min(1),
});

/**
 * Id of a persisted terminal session. It names one log file under
 * `.context/terminals/`, so anything that is not a single filename — a
 * separator, a relative hop, a NUL byte — is refused at the boundary rather
 * than resolved into a path the discard step would then unlink.
 */
export const terminalSessionIdSchema = z
	.string()
	.min(1)
	.refine(
		(value) =>
			!value.includes('/') &&
			!value.includes('\\') &&
			!value.includes('\0') &&
			value !== '.' &&
			value !== '..',
		{ message: 'A terminal session id must name a single log file.' },
	);

/**
 * Drops a `restoredFromId` that does not name a single log file, so a create
 * carrying a traversal id still launches — with no predecessor to supersede —
 * instead of reaching the path builder.
 * @param request - Raw create-terminal payload from the renderer.
 * @returns The request with an unusable `restoredFromId` removed.
 */
export function sanitizeCreateTerminalSessionRequest(
	request: CreateTerminalSessionRequest,
): CreateTerminalSessionRequest {
	if (terminalSessionIdSchema.safeParse(request.restoredFromId).success) {
		return request;
	}

	return { ...request, restoredFromId: undefined };
}
