/**
 * Repository-config IPC request schemas.
 *
 * **Lenient:** the handler calls `schema.safeParse(raw)` and falls back to an
 * empty repository path, and the schema trims the incoming path in place.
 */
import { z } from 'zod';

/** {@link import('../../../shared/ipc').RepositoryConfigRequest}. */
export const repositoryConfigRequestSchema = z.object({
	repositoryPath: z.string().transform((value) => value.trim()),
});

/**
 * Parses a repository-config request, preserving the legacy fallback of
 * `{ repositoryPath: '' }` on malformed input.
 * @param raw - Raw IPC payload.
 * @returns The normalized repository-config request.
 */
export function parseRepositoryConfigRequest(raw: unknown): {
	repositoryPath: string;
} {
	const parsed = repositoryConfigRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return { repositoryPath: '' };
	}
	return parsed.data;
}
