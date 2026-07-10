import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	RootDirectoryChangeApplyResult,
	RootDirectorySelectionResult,
	RootDirectorySnapshot,
} from '../../../shared/ipc/contracts/root-directory';
import type { SharedRootAdoptionService } from '../../repository';
import type { EnsemblrRootDirectoryService } from '../../root';
import type { WithPermissionGate } from '../permission-gate.ts';
import { parseRootDirectoryChangeRequest } from '../request-schemas.ts';
import { showDirectorySelectionDialog } from './dialog-helpers.ts';

/**
 * Registers IPC handlers for inspecting, picking, and applying root
 * directory changes.
 * @param options - Required services.
 */
export function registerRootHandlers({
	rootDirectoryService,
	sharedRootAdoptionService,
	withPermissionGate,
}: {
	rootDirectoryService: EnsemblrRootDirectoryService;
	sharedRootAdoptionService: SharedRootAdoptionService;
	withPermissionGate: WithPermissionGate;
}): void {
	ipcMain.handle(IPC_CHANNELS.rootDirectory, (): RootDirectorySnapshot => {
		return rootDirectoryService.getSnapshot() ?? rootDirectoryService.ensure();
	});

	ipcMain.handle(
		IPC_CHANNELS.selectRootDirectory,
		async (event): Promise<RootDirectorySelectionResult> => {
			const selection = await showDirectorySelectionDialog(event, {
				buttonLabel: 'Preview root',
				message:
					'Select the Ensemblr root directory to switch to. Existing contents are only inspected before confirmation.',
				properties: ['openDirectory', 'createDirectory'],
				title: 'Select Ensemblr root directory',
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

	withPermissionGate(
		IPC_CHANNELS.confirmRootDirectoryChange,
		'root-directory-change',
		(_event, request: unknown): RootDirectoryChangeApplyResult => {
			const normalizedRequest = parseRootDirectoryChangeRequest(request);

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
