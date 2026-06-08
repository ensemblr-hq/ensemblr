import { ipcMain } from 'electron';

import {
	IPC_CHANNELS,
	type RootDirectoryChangeApplyResult,
	type RootDirectoryChangeRequest,
	type RootDirectorySelectionResult,
	type RootDirectorySnapshot,
} from '../../../shared/ipc';
import type { SharedRootAdoptionService } from '../../repository';
import type { EnsembleRootDirectoryService } from '../../root';
import { showDirectorySelectionDialog } from './dialog-helpers.ts';

/** Service dependencies used by the root-directory IPC handlers. */
export interface RootHandlersOptions {
	rootDirectoryService: EnsembleRootDirectoryService;
	sharedRootAdoptionService: SharedRootAdoptionService;
}

/**
 * Registers IPC handlers for inspecting, picking, and applying root
 * directory changes.
 * @param options - Required services.
 */
export function registerRootHandlers({
	rootDirectoryService,
	sharedRootAdoptionService,
}: RootHandlersOptions): void {
	ipcMain.handle(IPC_CHANNELS.rootDirectory, (): RootDirectorySnapshot => {
		return rootDirectoryService.getSnapshot() ?? rootDirectoryService.ensure();
	});

	ipcMain.handle(
		IPC_CHANNELS.selectRootDirectory,
		async (event): Promise<RootDirectorySelectionResult> => {
			const selection = await showDirectorySelectionDialog(event, {
				buttonLabel: 'Preview root',
				message:
					'Select the Ensemble root directory to switch to. Existing contents are only inspected before confirmation.',
				properties: ['openDirectory', 'createDirectory'],
				title: 'Select Ensemble root directory',
			});

			if (selection.canceled) {
				return { canceled: true };
			}

			try {
				return {
					canceled: false,
					preview: rootDirectoryService.previewChange(selection.path),
				};
			} catch (error) {
				return {
					canceled: false,
					error:
						error instanceof Error
							? error.message
							: 'Failed to preview the selected root directory.',
				};
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.confirmRootDirectoryChange,
		(_event, request: unknown): RootDirectoryChangeApplyResult => {
			const normalizedRequest = normalizeRootDirectoryChangeRequest(request);

			if (!normalizedRequest.path) {
				return {
					applied: false,
					error: 'No root directory path was selected.',
					newRoot: null,
					oldRoot: rootDirectoryService.getSnapshot(),
					oldRootPreserved: true,
					reconciliation: null,
				};
			}

			const result = rootDirectoryService.applyChange(normalizedRequest);

			if (result.applied) {
				void sharedRootAdoptionService.reconcile();
			}

			return result;
		},
	);
}

/** Coerces an IPC payload into a {@link RootDirectoryChangeRequest}. */
function normalizeRootDirectoryChangeRequest(
	request: unknown,
): RootDirectoryChangeRequest {
	if (
		typeof request !== 'object' ||
		request === null ||
		!('path' in request) ||
		typeof request.path !== 'string'
	) {
		return { path: '' };
	}

	return { path: request.path.trim() };
}
