/**
 * Infisical account, link, and sync IPC request schemas.
 *
 * **Strict:** handlers call `schema.parse(raw)`, so a malformed renderer
 * payload throws and surfaces as an IPC error in the renderer.
 */
import { z } from 'zod';

const linkScopeSchema = z.enum(['repository', 'workspace']);

/** {@link import('../../../shared/ipc').InfisicalAccountRequest}. */
export const infisicalAccountRequestSchema = z.object({
	accountId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').AddInfisicalAccountRequest}. */
export const addInfisicalAccountRequestSchema = z.object({
	clientId: z.string().min(1),
	clientSecret: z.string().min(1),
	label: z.string().max(200),
	siteUrl: z.string().min(1),
});

/** {@link import('../../../shared/ipc').InfisicalLinkScopeRequest}. */
export const infisicalLinkScopeRequestSchema = z.object({
	scope: linkScopeSchema,
	scopeId: z.string().min(1),
});

/** {@link import('../../../shared/ipc').SetInfisicalLinkRequest}. */
export const setInfisicalLinkRequestSchema = z.object({
	accountId: z.string().min(1),
	enabled: z.boolean().optional(),
	environmentSlug: z.string().min(1),
	projectId: z.string().min(1),
	projectName: z.string().optional(),
	recursive: z.boolean().optional(),
	scope: linkScopeSchema,
	scopeId: z.string().min(1),
	secretPath: z.string().optional(),
});
