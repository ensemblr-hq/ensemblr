import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { RepositorySourcesService } from '../../repository';
import { listRepositorySourcesRequestSchema } from '../request-schemas.ts';

/**
 * Registers read-only IPC handlers for the create-from-source picker (branches,
 * pull requests, GitHub issues). No permission gate — these only read git/`gh`
 * state and never mutate the workspace.
 */
export function registerRepositorySourcesHandlers({
	repositorySourcesService,
}: {
	repositorySourcesService: RepositorySourcesService;
}): void {
	ipcMain.handle(IPC_CHANNELS.listRepositoryBranches, (_event, raw: unknown) =>
		repositorySourcesService.listBranches(
			listRepositorySourcesRequestSchema.parse(raw),
		),
	);
	ipcMain.handle(
		IPC_CHANNELS.listRepositoryPullRequests,
		(_event, raw: unknown) =>
			repositorySourcesService.listPullRequests(
				listRepositorySourcesRequestSchema.parse(raw),
			),
	);
	ipcMain.handle(IPC_CHANNELS.listRepositoryIssues, (_event, raw: unknown) =>
		repositorySourcesService.listIssues(
			listRepositorySourcesRequestSchema.parse(raw),
		),
	);
}
