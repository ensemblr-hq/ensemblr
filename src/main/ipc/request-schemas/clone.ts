/**
 * GitHub clone and repository-list IPC request schemas.
 *
 * **Lenient:** handlers call `schema.safeParse(raw)` and fall back to a
 * known-empty payload, letting the service layer emit a diagnostic instead of
 * throwing at the boundary.
 */
import { z } from 'zod';

/**
 * {@link import('../../../shared/ipc').CloneGithubRepositoryRequest}.
 *
 * The legacy normalizer omitted `destinationPath` from the result when the
 * incoming value was not a string. To preserve that exact key-omission
 * behaviour, callers should use {@link parseCloneGithubRepositoryRequest}
 * rather than `.parse()` directly.
 */
export const cloneGithubRepositoryRequestSchema = z.object({
	destinationPath: z.string().optional(),
	url: z.string(),
});

/** {@link import('../../../shared/ipc').CloneGithubRepositoryStartRequest}. */
export const cloneGithubRepositoryStartRequestSchema = z.object({
	jobId: z.string(),
});

/**
 * Parses a clone-prepare payload, preserving the exact key-omission semantics
 * of the legacy `normalizeCloneGithubRepositoryRequest`: bad shape → `{ url: '' }`,
 * non-string `destinationPath` → key omitted entirely from the returned object.
 * @param raw - Raw IPC payload.
 * @returns The normalized clone-prepare request.
 */
export function parseCloneGithubRepositoryRequest(
	raw: unknown,
): { destinationPath: string; url: string } | { url: string } {
	const parsed = cloneGithubRepositoryRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return { url: '' };
	}
	const { destinationPath, url } = parsed.data;
	return destinationPath !== undefined ? { destinationPath, url } : { url };
}

/**
 * Parses a clone-start payload, preserving the legacy fallback of
 * `{ jobId: '' }` when the payload is malformed or `jobId` is non-string.
 * @param raw - Raw IPC payload.
 * @returns The normalized clone-start request.
 */
export function parseCloneGithubRepositoryStartRequest(raw: unknown): {
	jobId: string;
} {
	const parsed = cloneGithubRepositoryStartRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return { jobId: '' };
	}
	return parsed.data;
}

/** {@link import('../../../shared/ipc').GithubRepositoryListRequest}. */
export const githubRepositoryListRequestSchema = z.object({
	scope: z.enum(['recent', 'full']).optional(),
});

/**
 * Parses a github-repository-list payload, defaulting a missing or malformed
 * `scope` to `'recent'` — the pre-existing default behaviour.
 * @param raw - Raw IPC payload.
 * @returns The normalized repository-list request.
 */
export function parseGithubRepositoryListRequest(raw: unknown): {
	scope: 'full' | 'recent';
} {
	const parsed = githubRepositoryListRequestSchema.safeParse(raw ?? {});
	return {
		scope: parsed.success ? (parsed.data.scope ?? 'recent') : 'recent',
	};
}
