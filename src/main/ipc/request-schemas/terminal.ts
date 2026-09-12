/**
 * Terminal IPC request schemas.
 *
 * **Lenient:** the terminal handlers historically forwarded their payload to
 * the service unvalidated, so this narrows the one field that reaches the
 * filesystem and leaves every other field's existing handling alone — a
 * malformed `restoredFromId` is dropped rather than failing the create.
 */
import { z } from 'zod';

import type { CreateTerminalSessionRequest } from '../../../shared/ipc/contracts/terminal';

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
