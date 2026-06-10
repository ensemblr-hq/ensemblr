/**
 * Zod schemas validating raw IPC payloads at the main-process boundary.
 *
 * Two flavours coexist here intentionally because the legacy handlers chose
 * two different stances on bad input:
 *
 *   - **Strict (chat-tab):** Throw when the renderer sends a malformed
 *     payload. Surfaces as an IPC error in the renderer. Schemas are used via
 *     `schema.parse(raw)`.
 *   - **Lenient (clone / root / repository-config):** Coerce malformed input
 *     into a known-empty payload (e.g. `{ url: '' }`) and let the service layer
 *     emit a diagnostic. Schemas are used via `schema.safeParse(raw)` with the
 *     fallback returned on failure.
 *
 * Replacing these hand-rolled validators with Zod must preserve the EXACT
 * pre-existing semantics — every chat-tab test and every clone/root/config
 * test must continue to pass. Any deviation is annotated inline.
 */
import { z } from 'zod';

// -----------------------------------------------------------------------------
// chat-tab — STRICT (throws on bad input)
// -----------------------------------------------------------------------------

/**
 * Matches the legacy `optionalNullableString` helper: `null` survives as
 * `null`, missing/undefined collapses to `undefined`, non-string values throw.
 */
const optionalNullableString = z.string().nullable().optional();

/**
 * Matches the legacy `optionalString` helper: `null` is coerced to
 * `undefined`, missing/undefined stays `undefined`, non-string values throw.
 *
 * Preserves the historical quirk that explicit `null` is silently collapsed
 * rather than rejected — chat-tab callers rely on this when forwarding
 * partially-filled forms.
 */
const optionalStringCoerceNullToUndefined = z
	.string()
	.nullish()
	.transform((value) => value ?? undefined);

/** {@link import('../../shared/ipc').ListChatTabsRequest}. */
export const listChatTabsRequestSchema = z.object({
	workspaceId: z.string().min(1),
});

/** {@link import('../../shared/ipc').OpenChatTabRequest}. */
export const openChatTabRequestSchema = z.object({
	piSessionId: optionalNullableString,
	title: optionalStringCoerceNullToUndefined,
	workspaceId: z.string().min(1),
});

/** {@link import('../../shared/ipc').CloseChatTabRequest}. */
export const closeChatTabRequestSchema = z.object({
	chatTabId: z.string().min(1),
});

/** {@link import('../../shared/ipc').BindPiSessionToTabRequest}. */
export const bindPiSessionToChatTabRequestSchema = z.object({
	chatTabId: z.string().min(1),
	piSessionId: z.string().min(1),
});

/** {@link import('../../shared/ipc').RestoreChatTabRequest}. */
export const restoreChatTabRequestSchema = z.object({
	chatTabId: z.string().min(1),
});

/** {@link import('../../shared/ipc').ListClosedChatTabsWithSummaryRequest}. */
export const listClosedChatTabsWithSummaryRequestSchema = z.object({
	workspaceId: z.string().min(1),
});

// -----------------------------------------------------------------------------
// pi-session — STRICT (throws on bad input, caught by handler try/catch)
//
// All renderer-facing Pi session IPC payloads validate here. Handlers already
// wrap calls in try/catch and surface failures as `{ error }`, so a Zod parse
// error becomes a controlled error response rather than an unhandled rejection.
// -----------------------------------------------------------------------------

/** {@link import('../../shared/ipc').OpenPiSessionRequest}. */
export const openPiSessionRequestSchema = z.object({
	chatTabId: optionalNullableString,
	initialPrompt: optionalNullableString,
	label: z.string().optional(),
	model: optionalNullableString,
	resumeSessionId: optionalNullableString,
	thinkingLevel: optionalNullableString,
	workspaceCwd: z.string(),
	workspaceId: z.string().min(1),
});

/** {@link import('../../shared/ipc').SubmitPiPromptRequest}. */
export const submitPiPromptRequestSchema = z.object({
	model: optionalNullableString,
	prompt: z.string(),
	sessionId: z.string().min(1),
	thinkingLevel: optionalNullableString,
});

/** {@link import('../../shared/ipc').StopPiSessionRequest}. */
export const stopPiSessionRequestSchema = z.object({
	reason: z.string().optional(),
	sessionId: z.string().min(1),
});

/** {@link import('../../shared/ipc').ListPiSessionsRequest}. */
export const listPiSessionsRequestSchema = z.object({
	workspaceId: z.string().min(1),
});

/** {@link import('../../shared/ipc').ListPiSessionEventsRequest}. */
export const listPiSessionEventsRequestSchema = z.object({
	branchId: z.string().min(1),
});

// -----------------------------------------------------------------------------
// clone — LENIENT (safeParse + empty fallback)
// -----------------------------------------------------------------------------

/**
 * {@link import('../../shared/ipc').CloneGithubRepositoryRequest}.
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

/** {@link import('../../shared/ipc').CloneGithubRepositoryStartRequest}. */
export const cloneGithubRepositoryStartRequestSchema = z.object({
	jobId: z.string(),
});

/**
 * Parses a clone-prepare payload, preserving the exact key-omission semantics
 * of the legacy `normalizeCloneGithubRepositoryRequest`: bad shape → `{ url: '' }`,
 * non-string `destinationPath` → key omitted entirely from the returned object.
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

// -----------------------------------------------------------------------------
// root — LENIENT (safeParse + empty fallback, trims path)
// -----------------------------------------------------------------------------

/** {@link import('../../shared/ipc').RootDirectoryChangeRequest}. */
export const rootDirectoryChangeRequestSchema = z.object({
	path: z.string().transform((value) => value.trim()),
});

/**
 * Parses a root-directory change payload, preserving the legacy fallback of
 * `{ path: '' }` on malformed input. The trimmed-path semantics from the
 * hand-rolled normalizer are preserved via the schema's `.transform()`.
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

// -----------------------------------------------------------------------------
// repository-config — LENIENT (safeParse + empty fallback, trims path)
// -----------------------------------------------------------------------------

/** {@link import('../../shared/ipc').RepositoryConfigRequest}. */
export const repositoryConfigRequestSchema = z.object({
	repositoryPath: z.string().transform((value) => value.trim()),
});

/**
 * {@link import('../../shared/ipc').RepositoryConfigMigrationRequest}.
 *
 * `overwrite` is preserved as the strict legacy boolean: only `true` survives,
 * anything else (including `false`) collapses to `undefined` so the resulting
 * object retains the historical narrow shape.
 */
export const repositoryConfigMigrationRequestSchema = z.object({
	overwrite: z
		.unknown()
		.optional()
		.transform((value) => (value === true ? true : undefined)),
	repositoryPath: z.string().transform((value) => value.trim()),
});

/**
 * Parses a repository-config request, preserving the legacy fallback of
 * `{ repositoryPath: '' }` on malformed input.
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

/**
 * Parses a repository-config migration request, preserving the legacy
 * fallback of `{ repositoryPath: '' }` on malformed input and the strict
 * `overwrite === true` test (any other value collapses to `undefined`).
 */
export function parseRepositoryConfigMigrationRequest(raw: unknown): {
	overwrite?: true | undefined;
	repositoryPath: string;
} {
	const parsed = repositoryConfigMigrationRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return { repositoryPath: '' };
	}
	return {
		overwrite: parsed.data.overwrite,
		repositoryPath: parsed.data.repositoryPath,
	};
}
