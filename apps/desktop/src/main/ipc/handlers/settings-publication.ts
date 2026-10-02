import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	ApplySettingsPublicationResult,
	CleanupSettingsPublicationResult,
	PreviewSettingsPublicationResult,
	RestoreSettingsPublicationResult,
	SettingsPublicationFailure,
	SettingsPublicationRecoveryStatusResult,
} from '../../../shared/ipc/contracts/settings-publication.ts';
import type { SettingsPublicationService } from '../../config';
import {
	parseApplySettingsPublicationRequest,
	parseCleanupSettingsPublicationRequest,
	parsePreviewSettingsPublicationRequest,
	parseRestoreSettingsPublicationRequest,
	parseSettingsPublicationRecoveryStatusRequest,
} from '../request-schemas.ts';

/** Locale-neutral failure reported for a malformed renderer payload. */
const INVALID_REQUEST_FAILURE: SettingsPublicationFailure = {
	code: 'invalid-request',
	message: 'The settings publication request was malformed.',
};

/**
 * Registers the IPC handlers for the guarded root-to-workspace settings
 * publication workflow. Handlers validate the raw payload and delegate to the
 * service; a schema miss returns the contract's `invalid-request` failure
 * envelope without calling the service.
 * @param options - The settings publication service to delegate to.
 */
export function registerSettingsPublicationHandlers({
	service,
}: {
	service: SettingsPublicationService;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.previewSettingsPublication,
		(_event, request: unknown): PreviewSettingsPublicationResult => {
			const parsed = parsePreviewSettingsPublicationRequest(request);
			if (!parsed) {
				return { failure: INVALID_REQUEST_FAILURE, preview: null };
			}
			return service.preview(parsed);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.applySettingsPublication,
		(_event, request: unknown): ApplySettingsPublicationResult => {
			const parsed = parseApplySettingsPublicationRequest(request);
			if (!parsed) {
				return {
					failure: INVALID_REQUEST_FAILURE,
					recoveryId: null,
					status: 'failed',
				};
			}
			return service.apply(parsed);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.cleanupSettingsPublication,
		(_event, request: unknown): CleanupSettingsPublicationResult => {
			const parsed = parseCleanupSettingsPublicationRequest(request);
			if (!parsed) {
				return { failure: INVALID_REQUEST_FAILURE, status: 'failed' };
			}
			return service.cleanup(parsed);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.restoreSettingsPublication,
		(_event, request: unknown): RestoreSettingsPublicationResult => {
			const parsed = parseRestoreSettingsPublicationRequest(request);
			if (!parsed) {
				return { failure: INVALID_REQUEST_FAILURE, status: 'failed' };
			}
			return service.restore(parsed);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.settingsPublicationRecoveryStatus,
		(_event, request: unknown): SettingsPublicationRecoveryStatusResult => {
			const parsed = parseSettingsPublicationRecoveryStatusRequest(request);
			if (!parsed) {
				return { failure: INVALID_REQUEST_FAILURE, recoveries: [] };
			}
			return service.recoveryStatus(parsed);
		},
	);
}
