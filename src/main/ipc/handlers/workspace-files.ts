import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	ListWorkspaceFilesRequest,
	ListWorkspaceFilesResult,
	ReadWorkspaceDirectoryRequest,
	ReadWorkspaceDirectoryResult,
	ReadWorkspaceFileRequest,
	ReadWorkspaceFileResult,
	WatchWorkspaceFilesRequest,
} from '../../../shared/ipc/contracts/workspace-files';
import type {
	ListWorkspaceFilesService,
	WorkspaceFilesWatcher,
} from '../../workspace-files';

/** Dependencies for registering the workspace-files IPC handlers. */
export interface WorkspaceFilesHandlersOptions {
	listWorkspaceFilesService: ListWorkspaceFilesService;
	workspaceFilesWatcher: WorkspaceFilesWatcher;
}

/** Registers the IPC handlers that list, read, and watch repo files. */
export function registerWorkspaceFilesHandlers({
	listWorkspaceFilesService,
	workspaceFilesWatcher,
}: WorkspaceFilesHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.listWorkspaceFiles,
		(
			_event,
			request: ListWorkspaceFilesRequest,
		): Promise<ListWorkspaceFilesResult> =>
			listWorkspaceFilesService.list(request),
	);
	ipcMain.handle(
		IPC_CHANNELS.readWorkspaceFile,
		(
			_event,
			request: ReadWorkspaceFileRequest,
		): Promise<ReadWorkspaceFileResult> =>
			listWorkspaceFilesService.read(request),
	);
	ipcMain.handle(
		IPC_CHANNELS.readWorkspaceDirectory,
		(
			_event,
			request: ReadWorkspaceDirectoryRequest,
		): Promise<ReadWorkspaceDirectoryResult> =>
			listWorkspaceFilesService.readDirectory(request),
	);
	ipcMain.handle(
		IPC_CHANNELS.watchWorkspaceFiles,
		(_event, request: WatchWorkspaceFilesRequest): void => {
			workspaceFilesWatcher.watch(request.workspaceCwd);
		},
	);
	ipcMain.handle(
		IPC_CHANNELS.unwatchWorkspaceFiles,
		(_event, request: WatchWorkspaceFilesRequest): void => {
			workspaceFilesWatcher.unwatch(request.workspaceCwd);
		},
	);
}
