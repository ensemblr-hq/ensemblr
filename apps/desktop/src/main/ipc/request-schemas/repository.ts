/**
 * Repository and workspace lifecycle IPC request schemas.
 *
 * **Lenient:** the repository IPC channels (`registerLocalRepository`,
 * `createWorkspace`, rename / archive / unarchive / delete, list-archived)
 * historically forwarded the renderer payload to the service layer without
 * validation. The services already emit diagnostics for missing or empty ids,
 * so we preserve that behaviour: malformed inputs collapse to a known-empty
 * shape that the service then turns into an error diagnostic rather than a
 * hard throw.
 */
import { z } from 'zod';
import { optionalBoolean, optionalTrimmedString } from './primitives.ts';

/** {@link import('../../../shared/ipc').RegisterLocalRepositoryRequest}. */
export const registerLocalRepositoryRequestSchema = z.object({
	name: optionalTrimmedString,
	path: z.string(),
});

/**
 * Parses a register-local-repository payload, falling back to `{ path: '' }`
 * on malformed input. The service emits a `repository-path-missing` diagnostic
 * in that case.
 * @param raw - Raw IPC payload.
 * @returns The normalized register-local-repository request.
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

/** {@link import('../../../shared/ipc').QuickStartProjectRequest}. */
export const quickStartProjectRequestSchema = z.object({
	name: z.string(),
	owner: optionalTrimmedString,
	parentPath: optionalTrimmedString,
});

/**
 * Parses a quick-start project payload, falling back to `{ name: '' }` on
 * malformed input. The service emits a name-validation diagnostic.
 * @param raw - Raw IPC payload.
 * @returns The normalized quick-start project request.
 */
export function parseQuickStartProjectRequest(raw: unknown): {
	name: string;
	owner?: string;
	parentPath?: string;
} {
	const parsed = quickStartProjectRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return { name: '' };
	}
	const { name, owner, parentPath } = parsed.data;
	return {
		name,
		...(owner !== undefined ? { owner } : {}),
		...(parentPath !== undefined ? { parentPath } : {}),
	};
}

/** Issue tracker reference a workspace can be created against. */
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

/**
 * How the new workspace's branch comes into being. Structural only: the ref
 * strings are checked against {@link import('../../repository/validate-git-ref').validateGitRef}
 * inside the creation service, which can name the offending branch in its
 * diagnostic instead of collapsing the whole request.
 */
const workspaceBranchPlanSchema = z.discriminatedUnion('kind', [
	z.object({ branch: z.string().trim().min(1), kind: z.literal('adopt') }),
	z.object({ forkRef: optionalTrimmedString, kind: z.literal('create') }),
]);

/** {@link import('../../../shared/ipc').CreateWorkspaceRequest}. */
export const createWorkspaceRequestSchema = z.object({
	baseBranch: optionalTrimmedString,
	branchName: optionalTrimmedString,
	branchPlan: workspaceBranchPlanSchema.optional(),
	linkedIssue: workspaceLinkedIssueSchema.optional(),
	name: optionalTrimmedString,
	placeholderName: z.boolean().optional(),
	repositoryId: z.string(),
});

/**
 * Parses a create-workspace payload, falling back to `{ repositoryId: '' }`
 * on malformed input. The service emits a `repository-id-required` diagnostic.
 * @param raw - Raw IPC payload.
 * @returns The normalized create-workspace request.
 */
export function parseCreateWorkspaceRequest(raw: unknown): {
	baseBranch?: string;
	branchName?: string;
	branchPlan?: z.infer<typeof workspaceBranchPlanSchema>;
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
		branchPlan,
		linkedIssue,
		name,
		placeholderName,
		repositoryId,
	} = parsed.data;
	const result: {
		baseBranch?: string;
		branchName?: string;
		branchPlan?: z.infer<typeof workspaceBranchPlanSchema>;
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
	if (branchPlan !== undefined) {
		result.branchPlan = branchPlan;
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

/** {@link import('../../../shared/ipc').SetWorkspaceBaseBranchRequest}. */
export const setWorkspaceBaseBranchRequestSchema = z.object({
	baseBranch: z.string().trim(),
	workspaceId: z.string().trim(),
});

/**
 * Parses a set-workspace-base-branch payload, falling back to empty strings on
 * malformed input. The service emits `workspace-not-found` or
 * `base-branch-invalid` diagnostics for those.
 * @param raw - Raw IPC payload.
 * @returns The normalized set-workspace-base-branch request.
 */
export function parseSetWorkspaceBaseBranchRequest(raw: unknown): {
	baseBranch: string;
	workspaceId: string;
} {
	const parsed = setWorkspaceBaseBranchRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return { baseBranch: '', workspaceId: '' };
	}
	return parsed.data;
}

/** {@link import('../../../shared/ipc').RenameWorkspaceRequest}. */
export const renameWorkspaceRequestSchema = z.object({
	branchName: optionalTrimmedString,
	name: optionalTrimmedString,
	workspaceId: z.string(),
});

/**
 * Parses a rename-workspace payload, falling back to `{ workspaceId: '' }`
 * on malformed input. The service emits a `workspace-not-found` diagnostic.
 * @param raw - Raw IPC payload.
 * @returns The normalized rename-workspace request.
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

/** {@link import('../../../shared/ipc').ContinueWorkspaceBranchRequest}. */
export const continueWorkspaceBranchRequestSchema = z.object({
	workspaceId: z.string(),
});

/**
 * Parses a continue-workspace-branch payload, falling back to
 * `{ workspaceId: '' }` on malformed input. The service emits a
 * `workspace-not-found` diagnostic.
 * @param raw - Raw IPC payload.
 * @returns The normalized continue-workspace-branch request.
 */
export function parseContinueWorkspaceBranchRequest(raw: unknown): {
	workspaceId: string;
} {
	const parsed = continueWorkspaceBranchRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return { workspaceId: '' };
	}
	return { workspaceId: parsed.data.workspaceId };
}

/** {@link import('../../../shared/ipc').ArchiveWorkspaceRequest}. */
export const archiveWorkspaceRequestSchema = z.object({
	branchCleanup: optionalBoolean,
	reason: optionalTrimmedString,
	workspaceId: z.string(),
});

/**
 * Parses an archive-workspace payload, falling back to `{ workspaceId: '' }`
 * on malformed input. The service emits a `workspace-id-required` diagnostic.
 * @param raw - Raw IPC payload.
 * @returns The normalized archive-workspace request.
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

/** {@link import('../../../shared/ipc').DeleteWorkspaceRequest}. */
export const deleteWorkspaceRequestSchema = z.object({
	workspaceId: z.string(),
});

/**
 * Parses a delete-workspace payload, falling back to `{ workspaceId: '' }`
 * on malformed input. The service emits a `workspace-id-required` diagnostic.
 * @param raw - Raw IPC payload.
 * @returns The normalized delete-workspace request.
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

/** {@link import('../../../shared/ipc').DeleteRepositoryRequest}. */
export const deleteRepositoryRequestSchema = z.object({
	deleteFolder: optionalBoolean,
	repositoryId: z.string(),
});

/**
 * Parses a delete-repository payload, falling back to `{ repositoryId: '' }`
 * on malformed input. The service emits a `repository-id-required` diagnostic.
 * A malformed payload also drops `deleteFolder`, so the destructive half can
 * never be inferred from input the schema could not read.
 * @param raw - Raw IPC payload.
 * @returns The normalized delete-repository request.
 */
export function parseDeleteRepositoryRequest(raw: unknown): {
	deleteFolder?: boolean;
	repositoryId: string;
} {
	const parsed = deleteRepositoryRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return { repositoryId: '' };
	}
	const { deleteFolder, repositoryId } = parsed.data;
	return deleteFolder !== undefined
		? { deleteFolder, repositoryId }
		: { repositoryId };
}

/** {@link import('../../../shared/ipc').ListArchivedWorkspacesRequest}. */
export const listArchivedWorkspacesRequestSchema = z.object({
	repositoryId: z.string(),
});

/**
 * Parses a list-archived-workspaces payload, falling back to
 * `{ repositoryId: '' }` on malformed input. The service returns an empty
 * `entries` list in that case.
 * @param raw - Raw IPC payload.
 * @returns The normalized list-archived-workspaces request.
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

/** {@link import('../../../shared/ipc').UnarchiveWorkspaceRequest}. */
export const unarchiveWorkspaceRequestSchema = z.object({
	reason: optionalTrimmedString,
	workspaceId: z.string(),
});

/**
 * Parses an unarchive-workspace payload, falling back to `{ workspaceId: '' }`
 * on malformed input. The service emits a `workspace-id-required` diagnostic.
 * @param raw - Raw IPC payload.
 * @returns The normalized unarchive-workspace request.
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

/** {@link import('../../../shared/ipc').DeleteArchivedWorkspaceRequest}. */
export const deleteArchivedWorkspaceRequestSchema = z.object({
	workspaceId: z.string(),
});

/**
 * Parses a delete-archived-workspace payload, falling back to
 * `{ workspaceId: '' }` on malformed input. The service emits a
 * `workspace-id-required` diagnostic.
 * @param raw - Raw IPC payload.
 * @returns The normalized delete-archived-workspace request.
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
