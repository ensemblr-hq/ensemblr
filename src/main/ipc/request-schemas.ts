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
	kind: z.enum(['chat', 'diff', 'document', 'file', 'preview']).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
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

/** {@link import('../../shared/ipc').ReorderChatTabsRequest}. */
export const reorderChatTabsRequestSchema = z.object({
	orderedIds: z.array(z.string().min(1)),
	workspaceId: z.string().min(1),
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
	streamingBehavior: z.enum(['steer', 'followUp']).optional(),
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

/** {@link import('../../shared/ipc').WriteForkSummaryRequest}. */
export const writeForkSummaryRequestSchema = z.object({
	branchId: z.string().min(1),
	fileBaseName: z.string().min(1),
	sessionId: z.string().min(1),
	targetWorkspaceCwd: z.string().min(1).optional(),
	upToOrdinal: z.number().int().nonnegative().optional(),
});

// -----------------------------------------------------------------------------
// workspace-files — STRICT (throws on bad input, caught by handler try/catch)
// -----------------------------------------------------------------------------

/**
 * {@link import('../../shared/ipc').WriteWorkspaceImageAttachmentRequest}.
 *
 * `contentBase64` is capped so an oversized paste is rejected before the handler
 * allocates the decoded buffer; ~20MB of base64 holds the 10MB decoded limit
 * (4/3 expansion) with margin for whitespace.
 */
export const writeWorkspaceImageAttachmentRequestSchema = z.object({
	contentBase64: z.string().min(1).max(20_000_000),
	mimeType: z.string().min(1).max(100),
	name: z.string().max(255).optional(),
	workspaceCwd: z.string().min(1),
});

/**
 * {@link import('../../shared/ipc').WriteWorkspaceFileAttachmentRequest}.
 *
 * `contentBase64` is capped so an oversized paste is rejected before the handler
 * allocates the decoded buffer; ~70MB of base64 holds the 50MB decoded ceiling
 * (`HARD_MAX_ATTACHMENT_BYTES`, 4/3 expansion) with margin for whitespace.
 */
export const writeWorkspaceFileAttachmentRequestSchema = z.object({
	contentBase64: z.string().min(1).max(70_000_000),
	name: z.string().max(255).optional(),
	workspaceCwd: z.string().min(1),
});

/**
 * {@link import('../../shared/ipc').WriteWorkspaceActionPromptRequest}. The
 * composed prompt is bounded well under the renderer's 24k review-context cap;
 * 200k characters leaves generous headroom without risking an unbounded write.
 */
export const writeWorkspaceActionPromptRequestSchema = z.object({
	action: z.string().min(1).max(64),
	content: z.string().min(1).max(200_000),
	workspaceCwd: z.string().min(1),
});

// -----------------------------------------------------------------------------
// checkpoint — STRICT (throws on bad input, caught by handler try/catch)
// -----------------------------------------------------------------------------

/** {@link import('../../shared/ipc').ListTurnCheckpointsRequest}. */
export const listTurnCheckpointsRequestSchema = z.object({
	piSessionId: z.string().min(1),
});

/** {@link import('../../shared/ipc').ComputeTurnDiffRequest}. */
export const computeTurnDiffRequestSchema = z.object({
	turnId: z.string().min(1),
});

/**
 * {@link import('../../shared/ipc').RestoreCheckpointRequest}. The literal
 * `confirm: true` enforces the destructive-action acknowledgment server-side.
 */
export const restoreCheckpointRequestSchema = z.object({
	confirm: z.literal(true),
	turnId: z.string().min(1),
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

/** {@link import('../../shared/ipc').GithubRepositoryListRequest}. */
export const githubRepositoryListRequestSchema = z.object({
	scope: z.enum(['recent', 'full']).optional(),
});

/**
 * Parses a github-repository-list payload, defaulting a missing or malformed
 * `scope` to `'recent'` — the pre-existing default behaviour.
 */
export function parseGithubRepositoryListRequest(raw: unknown): {
	scope: 'full' | 'recent';
} {
	const parsed = githubRepositoryListRequestSchema.safeParse(raw ?? {});
	return {
		scope: parsed.success ? (parsed.data.scope ?? 'recent') : 'recent',
	};
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
// repository — LENIENT (safeParse + empty fallback)
//
// The repository IPC channels (`registerLocalRepository`, `createWorkspace`,
// rename / archive / unarchive / delete, list-archived) historically forwarded
// the renderer payload to the service layer without validation. The services
// already emit diagnostics for missing or empty ids, so we preserve that
// behaviour: malformed inputs collapse to a known-empty shape that the
// service then turns into an error diagnostic rather than a hard throw.
// -----------------------------------------------------------------------------

const optionalTrimmedString = z
	.string()
	.optional()
	.transform((value) => (value === undefined ? undefined : value.trim()))
	.transform((value) =>
		value === undefined || value.length === 0 ? undefined : value,
	);

const optionalBoolean = z.boolean().optional();

/** {@link import('../../shared/ipc').RegisterLocalRepositoryRequest}. */
export const registerLocalRepositoryRequestSchema = z.object({
	name: optionalTrimmedString,
	path: z.string(),
});

/**
 * Parses a register-local-repository payload, falling back to `{ path: '' }`
 * on malformed input. The service emits a `repository-path-missing` diagnostic
 * in that case.
 */
export function parseRegisterLocalRepositoryRequest(raw: unknown): {
	name?: string;
	path: string;
} {
	const parsed = registerLocalRepositoryRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return { path: '' };
	}
	const { name, path } = parsed.data;
	return name !== undefined ? { name, path } : { path };
}

/** {@link import('../../shared/ipc').QuickStartProjectRequest}. */
export const quickStartProjectRequestSchema = z.object({
	name: z.string(),
	parentPath: optionalTrimmedString,
});

/**
 * Parses a quick-start project payload, falling back to `{ name: '' }` on
 * malformed input. The service emits a name-validation diagnostic.
 */
export function parseQuickStartProjectRequest(raw: unknown): {
	name: string;
	parentPath?: string;
} {
	const parsed = quickStartProjectRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return { name: '' };
	}
	const { name, parentPath } = parsed.data;
	return parentPath !== undefined ? { name, parentPath } : { name };
}

const workspaceLinkedIssueSchema = z.object({
	description: z.string().optional(),
	id: z.string().min(1),
	identifier: z.string().min(1),
	provider: z.enum(['github', 'linear']),
	teamKey: z.string().optional(),
	teamName: z.string().optional(),
	title: z.string().min(1),
	url: z.string(),
});

/** {@link import('../../shared/ipc').CreateWorkspaceRequest}. */
export const createWorkspaceRequestSchema = z.object({
	baseBranch: optionalTrimmedString,
	branchName: optionalTrimmedString,
	linkedIssue: workspaceLinkedIssueSchema.optional(),
	name: optionalTrimmedString,
	placeholderName: z.boolean().optional(),
	repositoryId: z.string(),
});

/**
 * Parses a create-workspace payload, falling back to `{ repositoryId: '' }`
 * on malformed input. The service emits a `repository-id-required` diagnostic.
 */
export function parseCreateWorkspaceRequest(raw: unknown): {
	baseBranch?: string;
	branchName?: string;
	linkedIssue?: z.infer<typeof workspaceLinkedIssueSchema>;
	name?: string;
	placeholderName?: boolean;
	repositoryId: string;
} {
	const parsed = createWorkspaceRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return { repositoryId: '' };
	}
	const {
		baseBranch,
		branchName,
		linkedIssue,
		name,
		placeholderName,
		repositoryId,
	} = parsed.data;
	const result: {
		baseBranch?: string;
		branchName?: string;
		linkedIssue?: z.infer<typeof workspaceLinkedIssueSchema>;
		name?: string;
		placeholderName?: boolean;
		repositoryId: string;
	} = { repositoryId };
	if (baseBranch !== undefined) {
		result.baseBranch = baseBranch;
	}
	if (branchName !== undefined) {
		result.branchName = branchName;
	}
	if (linkedIssue !== undefined) {
		result.linkedIssue = linkedIssue;
	}
	if (name !== undefined) {
		result.name = name;
	}
	if (placeholderName !== undefined) {
		result.placeholderName = placeholderName;
	}
	return result;
}

/** {@link import('../../shared/ipc').RenameWorkspaceRequest}. */
export const renameWorkspaceRequestSchema = z.object({
	branchName: optionalTrimmedString,
	name: optionalTrimmedString,
	workspaceId: z.string(),
});

/**
 * Parses a rename-workspace payload, falling back to `{ workspaceId: '' }`
 * on malformed input. The service emits a `workspace-not-found` diagnostic.
 */
export function parseRenameWorkspaceRequest(raw: unknown): {
	branchName?: string;
	name?: string;
	workspaceId: string;
} {
	const parsed = renameWorkspaceRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return { workspaceId: '' };
	}
	const { branchName, name, workspaceId } = parsed.data;
	const result: {
		branchName?: string;
		name?: string;
		workspaceId: string;
	} = { workspaceId };
	if (branchName !== undefined) {
		result.branchName = branchName;
	}
	if (name !== undefined) {
		result.name = name;
	}
	return result;
}

/** {@link import('../../shared/ipc').ArchiveWorkspaceRequest}. */
export const archiveWorkspaceRequestSchema = z.object({
	branchCleanup: optionalBoolean,
	reason: optionalTrimmedString,
	workspaceId: z.string(),
});

/**
 * Parses an archive-workspace payload, falling back to `{ workspaceId: '' }`
 * on malformed input. The service emits a `workspace-id-required` diagnostic.
 */
export function parseArchiveWorkspaceRequest(raw: unknown): {
	branchCleanup?: boolean;
	reason?: string;
	workspaceId: string;
} {
	const parsed = archiveWorkspaceRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return { workspaceId: '' };
	}
	const { branchCleanup, reason, workspaceId } = parsed.data;
	const result: {
		branchCleanup?: boolean;
		reason?: string;
		workspaceId: string;
	} = { workspaceId };
	if (branchCleanup !== undefined) {
		result.branchCleanup = branchCleanup;
	}
	if (reason !== undefined) {
		result.reason = reason;
	}
	return result;
}

/** {@link import('../../shared/ipc').ArchiveRepositoryRequest}. */
export const archiveRepositoryRequestSchema = z.object({
	branchCleanup: optionalBoolean,
	reason: optionalTrimmedString,
	repositoryId: z.string(),
});

/**
 * Parses an archive-repository payload, falling back to `{ repositoryId: '' }`
 * on malformed input. The service emits a `repository-id-required` diagnostic.
 */
export function parseArchiveRepositoryRequest(raw: unknown): {
	branchCleanup?: boolean;
	reason?: string;
	repositoryId: string;
} {
	const parsed = archiveRepositoryRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return { repositoryId: '' };
	}
	const { branchCleanup, reason, repositoryId } = parsed.data;
	const result: {
		branchCleanup?: boolean;
		reason?: string;
		repositoryId: string;
	} = { repositoryId };
	if (branchCleanup !== undefined) {
		result.branchCleanup = branchCleanup;
	}
	if (reason !== undefined) {
		result.reason = reason;
	}
	return result;
}

/** {@link import('../../shared/ipc').DeleteWorkspaceRequest}. */
export const deleteWorkspaceRequestSchema = z.object({
	workspaceId: z.string(),
});

/**
 * Parses a delete-workspace payload, falling back to `{ workspaceId: '' }`
 * on malformed input. The service emits a `workspace-id-required` diagnostic.
 */
export function parseDeleteWorkspaceRequest(raw: unknown): {
	workspaceId: string;
} {
	const parsed = deleteWorkspaceRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return { workspaceId: '' };
	}
	return parsed.data;
}

/** {@link import('../../shared/ipc').DeleteRepositoryRequest}. */
export const deleteRepositoryRequestSchema = z.object({
	repositoryId: z.string(),
});

/**
 * Parses a delete-repository payload, falling back to `{ repositoryId: '' }`
 * on malformed input. The service emits a `repository-id-required` diagnostic.
 */
export function parseDeleteRepositoryRequest(raw: unknown): {
	repositoryId: string;
} {
	const parsed = deleteRepositoryRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return { repositoryId: '' };
	}
	return parsed.data;
}

/** {@link import('../../shared/ipc').ListArchivedWorkspacesRequest}. */
export const listArchivedWorkspacesRequestSchema = z.object({
	repositoryId: z.string(),
});

/**
 * Parses a list-archived-workspaces payload, falling back to
 * `{ repositoryId: '' }` on malformed input. The service returns an empty
 * `entries` list in that case.
 */
export function parseListArchivedWorkspacesRequest(raw: unknown): {
	repositoryId: string;
} {
	const parsed = listArchivedWorkspacesRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return { repositoryId: '' };
	}
	return parsed.data;
}

/** {@link import('../../shared/ipc').UnarchiveWorkspaceRequest}. */
export const unarchiveWorkspaceRequestSchema = z.object({
	reason: optionalTrimmedString,
	workspaceId: z.string(),
});

/**
 * Parses an unarchive-workspace payload, falling back to `{ workspaceId: '' }`
 * on malformed input. The service emits a `workspace-id-required` diagnostic.
 */
export function parseUnarchiveWorkspaceRequest(raw: unknown): {
	reason?: string;
	workspaceId: string;
} {
	const parsed = unarchiveWorkspaceRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return { workspaceId: '' };
	}
	const { reason, workspaceId } = parsed.data;
	return reason !== undefined ? { reason, workspaceId } : { workspaceId };
}

/** {@link import('../../shared/ipc').DeleteArchivedWorkspaceRequest}. */
export const deleteArchivedWorkspaceRequestSchema = z.object({
	workspaceId: z.string(),
});

/**
 * Parses a delete-archived-workspace payload, falling back to
 * `{ workspaceId: '' }` on malformed input. The service emits a
 * `workspace-id-required` diagnostic.
 */
export function parseDeleteArchivedWorkspaceRequest(raw: unknown): {
	workspaceId: string;
} {
	const parsed = deleteArchivedWorkspaceRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return { workspaceId: '' };
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

// -----------------------------------------------------------------------------
// workspace-scripts — LENIENT (safeParse + null fallback)
// -----------------------------------------------------------------------------

/** {@link import('../../shared/ipc').UpdateRepositoryScriptsRequest}. */
export const updateRepositoryScriptsRequestSchema = z.object({
	archive: z.string().nullable(),
	autoRunAfterSetup: z.boolean(),
	repositoryId: z.string().min(1),
	run: z.string().nullable(),
	runScriptMode: z.enum(['concurrent', 'nonconcurrent']),
	setup: z.string().nullable(),
});

/**
 * Parses a Scripts-settings write request, returning `null` on malformed input
 * so the handler can report a no-op without touching SQLite.
 */
export function parseUpdateRepositoryScriptsRequest(
	raw: unknown,
): z.infer<typeof updateRepositoryScriptsRequestSchema> | null {
	const parsed = updateRepositoryScriptsRequestSchema.safeParse(raw);

	return parsed.success ? parsed.data : null;
}

// -----------------------------------------------------------------------------
// review — STRICT (throws on bad input)
// -----------------------------------------------------------------------------

/** {@link import('../../shared/ipc').ListReviewCommentsRequest} and {@link import('../../shared/ipc').ListReviewTodosRequest}. */
export const reviewListRequestSchema = z.object({
	workspaceId: z.string().min(1),
});

/** {@link import('../../shared/ipc').DeleteReviewCommentRequest} and {@link import('../../shared/ipc').DeleteReviewTodoRequest}. */
export const reviewDeleteRequestSchema = z.object({ id: z.string().min(1) });

/** {@link import('../../shared/ipc').SaveReviewCommentRequest}. */
export const saveReviewCommentRequestSchema = z.object({
	body: z.string().optional(),
	filePath: z.string().optional(),
	id: z.string().optional(),
	lineNumber: z.number().int().nullable().optional(),
	status: z.enum(['archived', 'open', 'resolved']).optional(),
	workspaceId: z.string().min(1),
});

/** {@link import('../../shared/ipc').SaveReviewTodoRequest}. */
export const saveReviewTodoRequestSchema = z.object({
	id: z.string().optional(),
	status: z.enum(['canceled', 'done', 'in_progress', 'open']).optional(),
	title: z.string().optional(),
	workspaceId: z.string().min(1),
});

// -----------------------------------------------------------------------------
// github — STRICT (throws on bad input)
//
// These payloads carry renderer-supplied filesystem paths that ultimately
// reach `git`/`gh` invocations, so they must be validated at the boundary.
// -----------------------------------------------------------------------------

/** {@link import('../../shared/ipc').CommitWorkspaceChangesRequest}. */
export const commitWorkspaceChangesRequestSchema = z.object({
	message: z.string().min(1),
	paths: z.array(z.string().min(1)).optional(),
	workspaceCwd: z.string().min(1),
});

/** {@link import('../../shared/ipc').PushWorkspaceBranchRequest}. */
export const pushWorkspaceBranchRequestSchema = z.object({
	setUpstream: z.boolean().optional(),
	workspaceCwd: z.string().min(1),
});

/** {@link import('../../shared/ipc').CreatePullRequestRequest}. */
export const createPullRequestRequestSchema = z.object({
	baseBranch: z.string().min(1).optional(),
	body: z.string(),
	draft: z.boolean().optional(),
	title: z.string().min(1),
	workspaceCwd: z.string().min(1),
});

/** {@link import('../../shared/ipc').GetPullRequestSnapshotRequest}. */
export const getPullRequestSnapshotRequestSchema = z.object({
	refresh: z.boolean().optional(),
	workspaceCwd: z.string().min(1),
	workspaceId: z.string().min(1),
});

/** {@link import('../../shared/ipc').MergePullRequestRequest}. */
export const mergePullRequestRequestSchema = z.object({
	method: z.enum(['merge', 'rebase', 'squash']).optional(),
	workspaceCwd: z.string().min(1),
	workspaceId: z.string().min(1),
});

/**
 * {@link import('../../shared/ipc/contracts/workspace-sources').ListRepositoryBranchesRequest}
 * and its PR/issue siblings — all just a repository id.
 */
export const listRepositorySourcesRequestSchema = z.object({
	repositoryId: z.string().min(1),
});

// -----------------------------------------------------------------------------
// workspace-git — STRICT (throws on bad input)
// -----------------------------------------------------------------------------

/**
 * A git ref (branch name, tag, etc.) that reaches `git` directly: restricted to
 * safe ref characters and never starting with `-` (which git reads as a flag).
 */
const gitRefSchema = z
	.string()
	.min(1)
	.max(255)
	.regex(/^(?!-)[\w./@+~^-]+$/);

/**
 * {@link import('../../shared/ipc').WorkspaceGitDiffScope}. The commit hash also
 * reaches `git` directly, so it is restricted to hex characters.
 */
const workspaceGitDiffScopeSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('working-tree') }),
	z.object({
		commitHash: z.string().regex(/^[0-9a-fA-F]{4,40}$/),
		kind: z.literal('commit'),
	}),
	z.object({
		baseRef: gitRefSchema,
		kind: z.literal('branch'),
	}),
]);

/** {@link import('../../shared/ipc').GetWorkspaceGitStatusRequest}. */
export const getWorkspaceGitStatusRequestSchema = z.object({
	scope: workspaceGitDiffScopeSchema.optional(),
	workspaceCwd: z.string().min(1),
});

/** {@link import('../../shared/ipc').GetWorkspaceFileDiffRequest}. */
export const getWorkspaceFileDiffRequestSchema = z.object({
	path: z.string().min(1),
	scope: workspaceGitDiffScopeSchema.optional(),
	workspaceCwd: z.string().min(1),
});

/** {@link import('../../shared/ipc').GetWorkspaceCommitsRequest}. */
export const getWorkspaceCommitsRequestSchema = z.object({
	baseRef: gitRefSchema.optional(),
	limit: z.number().int().positive().max(100).optional(),
	workspaceCwd: z.string().min(1),
});

/** {@link import('../../shared/ipc').DiscardWorkspaceChangesRequest}. */
export const discardWorkspaceChangesRequestSchema = z.object({
	paths: z.array(z.string().min(1)).min(1).max(1000),
	workspaceCwd: z.string().min(1),
});

// -----------------------------------------------------------------------------
// linear — STRICT (throws on bad input)
// -----------------------------------------------------------------------------

const linearIssueFieldsShape = {
	assigneeId: z.string().min(1).optional(),
	cycleId: z.string().min(1).optional(),
	description: z.string().optional(),
	dueDate: z.string().optional(),
	labelIds: z.array(z.string().min(1)).optional(),
	// Linear priority scale: 0=none, 1=urgent, 2=high, 3=medium, 4=low.
	priority: z.number().int().min(0).max(4).optional(),
	projectId: z.string().min(1).optional(),
	stateId: z.string().min(1).optional(),
};

/** {@link import('../../shared/ipc').ListLinearIssuesRequest}. */
export const listLinearIssuesRequestSchema = z
	.object({
		query: z.string().optional(),
		refresh: z.boolean().optional(),
		teamId: z.string().min(1).optional(),
	})
	.optional()
	.transform((value) => value ?? {});

/** {@link import('../../shared/ipc').GetLinearIssueRequest}. */
export const getLinearIssueRequestSchema = z.object({
	id: z.string().min(1),
	refresh: z.boolean().optional(),
});

/** {@link import('../../shared/ipc').GetLinearMetadataRequest}. */
export const getLinearMetadataRequestSchema = z
	.object({
		refresh: z.boolean().optional(),
	})
	.optional()
	.transform((value) => value ?? {});

/** {@link import('../../shared/ipc').CreateLinearIssueRequest}. */
export const createLinearIssueRequestSchema = z.object({
	...linearIssueFieldsShape,
	teamId: z.string().min(1),
	title: z.string().min(1),
});

/** {@link import('../../shared/ipc').UpdateLinearIssueRequest}. */
export const updateLinearIssueRequestSchema = z.object({
	id: z.string().min(1),
	input: z.object({
		...linearIssueFieldsShape,
		teamId: z.string().min(1).optional(),
		title: z.string().min(1).optional(),
	}),
});

/** {@link import('../../shared/ipc').CreateLinearCommentRequest}. */
export const createLinearCommentRequestSchema = z.object({
	body: z.string().min(1),
	issueId: z.string().min(1),
});
