import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	CloneDestinationSelectionResult,
	CloneGithubRepositoryPrepareResult,
	CloneGithubRepositoryStartResult,
	GithubRepositoryListResult,
} from '../../../shared/ipc/contracts/clone';
import type {
	GithubCloneService,
	GithubRepositoryListService,
} from '../../repository';
import type { WithPermissionGate } from '../permission-gate.ts';
import {
	parseCloneGithubRepositoryRequest,
	parseCloneGithubRepositoryStartRequest,
	parseGithubRepositoryListRequest,
} from '../request-schemas.ts';
import { showDirectorySelectionDialog } from './dialog-helpers.ts';

/** Service dependencies used by the GitHub clone IPC handlers. */
export interface CloneHandlersOptions {
	githubCloneService: GithubCloneService;
	githubRepositoryListService: GithubRepositoryListService;
	withPermissionGate: WithPermissionGate;
}

/**
 * Registers IPC handlers for listing, picking a destination for, and cloning
 * GitHub repositories.
 * @param options - Required services.
 */
export function registerCloneHandlers({
	githubCloneService,
	githubRepositoryListService,
	withPermissionGate,
}: CloneHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.githubRepositoryList,
		(_event, request: unknown): Promise<GithubRepositoryListResult> => {
			return githubRepositoryListService.list(
				parseGithubRepositoryListRequest(request),
			);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.selectCloneDestination,
		(event): Promise<CloneDestinationSelectionResult> =>
			showDirectorySelectionDialog(event, {
				buttonLabel: 'Select destination',
				message:
					'Select the parent directory where the GitHub repository should be cloned.',
				properties: ['openDirectory', 'createDirectory'],
				title: 'Select clone destination',
			}),
	);

	ipcMain.handle(
		IPC_CHANNELS.cloneGithubRepositoryPrepare,
		(_event, request: unknown): Promise<CloneGithubRepositoryPrepareResult> => {
			return githubCloneService.prepare(
				parseCloneGithubRepositoryRequest(request),
			);
		},
	);

	withPermissionGate(
		IPC_CHANNELS.cloneGithubRepositoryStart,
		'outside-workspace-write',
		(event, request: unknown): Promise<CloneGithubRepositoryStartResult> => {
			const normalized = parseCloneGithubRepositoryStartRequest(request);
			return githubCloneService.start(normalized, {
				onProgress: (payload) => {
					if (event.sender.isDestroyed()) {
						return;
					}
					event.sender.send(
						IPC_CHANNELS.cloneGithubRepositoryProgress,
						payload,
					);
				},
			});
		},
	);
}
