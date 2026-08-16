/**
 * Linear issue and comment IPC request schemas.
 *
 * **Strict:** handlers call `schema.parse(raw)`, so a malformed renderer
 * payload throws and surfaces as an IPC error in the renderer.
 */
import { z } from 'zod';

/**
 * Account selector shared by every Linear request. Optional throughout: the
 * service resolves the owning account from the entity a request names, and only
 * an ambiguous read needs the caller to pick one.
 */
const linearAccountId = z.string().min(1).optional();

/**
 * Account to fall back to when the entity a request names resolves no account of
 * its own. Applied strictly after the entity lookup, so it can never mask an
 * entity that belongs elsewhere nor pre-empt an ambiguity refusal.
 */
const linearFallbackAccountId = z.string().min(1).optional();

/** Issue fields shared by the Linear create and update request schemas. */
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

/** {@link import('../../../shared/ipc').ListLinearIssuesRequest}. */
export const listLinearIssuesRequestSchema = z
	.object({
		accountId: linearAccountId,
		query: z.string().optional(),
		refresh: z.boolean().optional(),
		teamId: z.string().min(1).optional(),
	})
	.optional()
	.transform((value) => value ?? {});

/** {@link import('../../../shared/ipc').GetLinearIssueRequest}. */
export const getLinearIssueRequestSchema = z.object({
	accountId: linearAccountId,
	fallbackAccountId: linearFallbackAccountId,
	id: z.string().min(1),
	refresh: z.boolean().optional(),
});

/** {@link import('../../../shared/ipc').GetLinearMetadataRequest}. */
export const getLinearMetadataRequestSchema = z
	.object({
		accountId: linearAccountId,
		refresh: z.boolean().optional(),
	})
	.optional()
	.transform((value) => value ?? {});

/** {@link import('../../../shared/ipc').CreateLinearIssueRequest}. */
export const createLinearIssueRequestSchema = z.object({
	...linearIssueFieldsShape,
	accountId: linearAccountId,
	fallbackAccountId: linearFallbackAccountId,
	teamId: z.string().min(1),
	title: z.string().min(1),
});

/** {@link import('../../../shared/ipc').UpdateLinearIssueRequest}. */
export const updateLinearIssueRequestSchema = z.object({
	accountId: linearAccountId,
	fallbackAccountId: linearFallbackAccountId,
	id: z.string().min(1),
	input: z.object({
		...linearIssueFieldsShape,
		dueDate: z.string().nullable().optional(),
		teamId: z.string().min(1).optional(),
		title: z.string().min(1).optional(),
	}),
});

/** {@link import('../../../shared/ipc').CreateLinearCommentRequest}. */
export const createLinearCommentRequestSchema = z.object({
	accountId: linearAccountId,
	body: z.string().min(1),
	fallbackAccountId: linearFallbackAccountId,
	issueId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').LinearDisconnectRequest}. */
export const linearDisconnectRequestSchema = z.object({
	accountId: z.string().min(1),
});
