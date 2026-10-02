/**
 * Settings publication IPC request schemas.
 *
 * **Strict-reject:** every one of these operations mutates a checkout, so a
 * malformed payload never reaches the service. Each parse helper returns the
 * validated request or the contract's own `invalid-request` failure envelope,
 * built by the caller, rather than throwing or coercing to a fallback value.
 */
import { z } from 'zod';

/** {@link import('../../../shared/ipc/contracts/settings-publication.ts').PreviewSettingsPublicationRequest}. */
export const previewSettingsPublicationRequestSchema = z.object({
	repositoryId: z.string().min(1),
	workspaceId: z.string().min(1),
});

/**
 * Parses a preview request.
 * @param raw - Raw IPC payload.
 * @returns The validated request, or `null` when the payload is malformed.
 */
export function parsePreviewSettingsPublicationRequest(
	raw: unknown,
): z.infer<typeof previewSettingsPublicationRequestSchema> | null {
	const parsed = previewSettingsPublicationRequestSchema.safeParse(raw);

	return parsed.success ? parsed.data : null;
}

/** {@link import('../../../shared/ipc/contracts/settings-publication.ts').ApplySettingsPublicationRequest}. */
export const applySettingsPublicationRequestSchema = z.object({
	previewToken: z.string().min(1),
	repositoryId: z.string().min(1),
	workspaceId: z.string().min(1),
});

/**
 * Parses an apply request.
 * @param raw - Raw IPC payload.
 * @returns The validated request, or `null` when the payload is malformed.
 */
export function parseApplySettingsPublicationRequest(
	raw: unknown,
): z.infer<typeof applySettingsPublicationRequestSchema> | null {
	const parsed = applySettingsPublicationRequestSchema.safeParse(raw);

	return parsed.success ? parsed.data : null;
}

/** {@link import('../../../shared/ipc/contracts/settings-publication.ts').CleanupSettingsPublicationRequest}. */
export const cleanupSettingsPublicationRequestSchema = z.object({
	recoveryId: z.string().min(1),
});

/**
 * Parses a cleanup request.
 * @param raw - Raw IPC payload.
 * @returns The validated request, or `null` when the payload is malformed.
 */
export function parseCleanupSettingsPublicationRequest(
	raw: unknown,
): z.infer<typeof cleanupSettingsPublicationRequestSchema> | null {
	const parsed = cleanupSettingsPublicationRequestSchema.safeParse(raw);

	return parsed.success ? parsed.data : null;
}

/** {@link import('../../../shared/ipc/contracts/settings-publication.ts').RestoreSettingsPublicationRequest}. */
export const restoreSettingsPublicationRequestSchema = z.object({
	copy: z.enum(['destination', 'source']),
	recoveryId: z.string().min(1),
});

/**
 * Parses a restore request.
 * @param raw - Raw IPC payload.
 * @returns The validated request, or `null` when the payload is malformed.
 */
export function parseRestoreSettingsPublicationRequest(
	raw: unknown,
): z.infer<typeof restoreSettingsPublicationRequestSchema> | null {
	const parsed = restoreSettingsPublicationRequestSchema.safeParse(raw);

	return parsed.success ? parsed.data : null;
}

/** {@link import('../../../shared/ipc/contracts/settings-publication.ts').SettingsPublicationRecoveryStatusRequest}. */
export const settingsPublicationRecoveryStatusRequestSchema = z.object({
	repositoryId: z.string().min(1),
});

/**
 * Parses a recovery-status request.
 * @param raw - Raw IPC payload.
 * @returns The validated request, or `null` when the payload is malformed.
 */
export function parseSettingsPublicationRecoveryStatusRequest(
	raw: unknown,
): z.infer<typeof settingsPublicationRecoveryStatusRequestSchema> | null {
	const parsed = settingsPublicationRecoveryStatusRequestSchema.safeParse(raw);

	return parsed.success ? parsed.data : null;
}
