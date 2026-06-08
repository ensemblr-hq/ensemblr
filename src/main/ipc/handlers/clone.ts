import { ipcMain } from 'electron';

import {
	type CloneDestinationSelectionResult,
	type CloneGithubRepositoryPrepareResult,
	type CloneGithubRepositoryRequest,
	type CloneGithubRepositoryStartRequest,
	type CloneGithubRepositoryStartResult,
	type GithubRepositoryListResult,
	IPC_CHANNELS,
} from '../../../shared/ipc';
import type {
	GithubCloneService,
	GithubRepositoryListService,
} from '../../repository';
import { showDirectorySelectionDialog } from './dialog-helpers.ts';

/** Service dependencies used by the GitHub clone IPC handlers. */
export interface CloneHandlersOptions {
	githubCloneService: GithubCloneService;
	githubRepositoryListService: GithubRepositoryListService;
}

/**
 * Registers IPC handlers for listing, picking a destination for, and cloning
 * GitHub repositories.
 * @param options - Required services.
 */
export function registerCloneHandlers({
	githubCloneService,
	githubRepositoryListService,
}: CloneHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.githubRepositoryList,
		(): Promise<GithubRepositoryListResult> => {
			return githubRepositoryListService.list();
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
				normalizeCloneGithubRepositoryRequest(request),
			);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.cloneGithubRepositoryStart,
		(event, request: unknown): Promise<CloneGithubRepositoryStartResult> => {
			const normalized = normalizeCloneGithubRepositoryStartRequest(request);
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

/** Coerces an IPC payload into a {@link CloneGithubRepositoryRequest}. */
function normalizeCloneGithubRepositoryRequest(
	request: unknown,
): CloneGithubRepositoryRequest {
	if (typeof request !== 'object' || request === null) {
		return { url: '' };
	}

	const url =
		'url' in request && typeof request.url === 'string' ? request.url : '';
	const destinationPath =
		'destinationPath' in request && typeof request.destinationPath === 'string'
			? request.destinationPath
			: undefined;

	return destinationPath !== undefined ? { destinationPath, url } : { url };
}

/** Coerces an IPC payload into a {@link CloneGithubRepositoryStartRequest}. */
function normalizeCloneGithubRepositoryStartRequest(
	request: unknown,
): CloneGithubRepositoryStartRequest {
	if (
		typeof request !== 'object' ||
		request === null ||
		!('jobId' in request) ||
		typeof request.jobId !== 'string'
	) {
		return { jobId: '' };
	}

	return { jobId: request.jobId };
}
