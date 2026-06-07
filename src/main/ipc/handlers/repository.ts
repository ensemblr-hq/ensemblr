import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';

import {
	IPC_CHANNELS,
	type LocalRepositorySelectionResult,
	type QuickStartProjectRequest,
	type QuickStartProjectResult,
	type RegisterLocalRepositoryRequest,
	type RegisterLocalRepositoryResult,
} from '../../../shared/ipc';
import type {
	LocalRepositoryRegistrationService,
	QuickStartProjectService,
} from '../../repository';

/** Service dependencies used by the local-repository IPC handlers. */
export interface RepositoryHandlersOptions {
	localRepositoryRegistrationService: LocalRepositoryRegistrationService;
	quickStartProjectService: QuickStartProjectService;
}

/**
 * Registers IPC handlers for picking, registering, and quick-starting local
 * repositories.
 * @param options - Required services.
 */
export function registerRepositoryHandlers({
	localRepositoryRegistrationService,
	quickStartProjectService,
}: RepositoryHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.selectLocalRepository,
		async (event): Promise<LocalRepositorySelectionResult> => {
			const window = BrowserWindow.fromWebContents(event.sender);
			const options: OpenDialogOptions = {
				buttonLabel: 'Register repository',
				message:
					'Select an existing local git repository to register with Ensemble.',
				properties: ['openDirectory'],
				title: 'Register local repository',
			};
			const result = window
				? await dialog.showOpenDialog(window, options)
				: await dialog.showOpenDialog(options);

			if (result.canceled || !result.filePaths[0]) {
				return { canceled: true };
			}

			return { canceled: false, path: result.filePaths[0] };
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.registerLocalRepository,
		(_event, request: unknown): Promise<RegisterLocalRepositoryResult> => {
			return localRepositoryRegistrationService.register(
				normalizeRegisterLocalRepositoryRequest(request),
			);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.quickStartProject,
		(_event, request: unknown): Promise<QuickStartProjectResult> => {
			return quickStartProjectService.create(
				normalizeQuickStartProjectRequest(request),
			);
		},
	);
}

/** Coerces an IPC payload into a {@link RegisterLocalRepositoryRequest}. */
function normalizeRegisterLocalRepositoryRequest(
	request: unknown,
): RegisterLocalRepositoryRequest {
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

/** Coerces an IPC payload into a {@link QuickStartProjectRequest}. */
function normalizeQuickStartProjectRequest(
	request: unknown,
): QuickStartProjectRequest {
	if (typeof request !== 'object' || request === null) {
		return { name: '' };
	}

	const name =
		'name' in request && typeof request.name === 'string' ? request.name : '';
	const parentPath =
		'parentPath' in request && typeof request.parentPath === 'string'
			? request.parentPath
			: undefined;

	return parentPath !== undefined ? { name, parentPath } : { name };
}
