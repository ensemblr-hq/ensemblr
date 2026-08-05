/**
 * Repository scripts and personal repository-settings IPC request schemas.
 *
 * **Lenient:** the parse helpers return `null` on malformed input so handlers
 * can report a no-op without touching SQLite.
 */
import { z } from 'zod';

/** One `[[scripts.run]]`-shaped entry accepted by the Scripts-settings writer. */
const workspaceRunTargetInputSchema = z.object({
	command: z.string().min(1),
	id: z.string().optional(),
	name: z.string(),
});

/** {@link import('../../../shared/ipc').UpdateRepositoryScriptsRequest}. */
export const updateRepositoryScriptsRequestSchema = z.object({
	archive: z.string().nullable(),
	autoRunAfterSetup: z.boolean(),
	repositoryId: z.string().min(1),
	run: z.array(workspaceRunTargetInputSchema).nullable(),
	runScriptMode: z.enum(['concurrent', 'nonconcurrent']),
	setup: z.string().nullable(),
});

/**
 * Parses a Scripts-settings write request, returning `null` on malformed input
 * so the handler can report a no-op without touching SQLite.
 * @param raw - Raw IPC payload.
 * @returns The validated request, or `null` when the payload is malformed.
 */
export function parseUpdateRepositoryScriptsRequest(
	raw: unknown,
): z.infer<typeof updateRepositoryScriptsRequestSchema> | null {
	const parsed = updateRepositoryScriptsRequestSchema.safeParse(raw);

	return parsed.success ? parsed.data : null;
}

/** Preview URL entry accepted by the repository-settings writer. */
const repositoryPreviewUrlSchema = z.object({
	name: z.string(),
	url: z.string(),
});

/**
 * Personal repository settings patch. Every field is optional; an explicit
 * `null` clears the stored row so the value falls back to the next resolver
 * source. {@link import('../../../shared/ipc').RepositorySettingsPatch}.
 */
const repositorySettingsPatchSchema = z.object({
	archiveAfterMerge: z.boolean().nullable().optional(),
	branchFrom: z.string().nullable().optional(),
	deleteLocalBranchOnArchive: z.boolean().nullable().optional(),
	filesToCopy: z.array(z.string()).nullable().optional(),
	previewUrls: z.array(repositoryPreviewUrlSchema).nullable().optional(),
	remoteOrigin: z.string().nullable().optional(),
});

/** {@link import('../../../shared/ipc').UpdateRepositorySettingsRequest}. */
export const updateRepositorySettingsRequestSchema = z.object({
	repositoryId: z.string().min(1),
	settings: repositorySettingsPatchSchema,
});

/**
 * Parses a repo-settings write request, returning `null` on malformed input so
 * the handler can report a no-op without touching SQLite.
 * @param raw - Raw IPC payload.
 * @returns The validated request, or `null` when the payload is malformed.
 */
export function parseUpdateRepositorySettingsRequest(
	raw: unknown,
): z.infer<typeof updateRepositorySettingsRequestSchema> | null {
	const parsed = updateRepositorySettingsRequestSchema.safeParse(raw);

	return parsed.success ? parsed.data : null;
}
