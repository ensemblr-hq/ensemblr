/**
 * Managed root-directory IPC request schemas.
 *
 * **Lenient:** the handler calls `schema.safeParse(raw)` and falls back to an
 * empty path, and the schema trims the incoming path in place.
 */
import { z } from 'zod';

/** {@link import('../../../shared/ipc').RootDirectoryChangeRequest}. */
export const rootDirectoryChangeRequestSchema = z.object({
	path: z.string().transform((value) => value.trim()),
});

/**
 * Parses a root-directory change payload, preserving the legacy fallback of
 * `{ path: '' }` on malformed input. The trimmed-path semantics from the
 * hand-rolled normalizer are preserved via the schema's `.transform()`.
 * @param raw - Raw IPC payload.
 * @returns The normalized root-directory change request.
 */
export function parseRootDirectoryChangeRequest(raw: unknown): {
	path: string;
} {
	const parsed = rootDirectoryChangeRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return { path: '' };
	}
	return parsed.data;
}
