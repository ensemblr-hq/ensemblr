import { ipcMain } from 'electron';

import {
	IPC_CHANNELS,
	type ListWorkspaceFilesRequest,
	type ListWorkspaceFilesResult,
	type ReadWorkspaceFileRequest,
	type ReadWorkspaceFileResult,
} from '../../../shared/ipc';
import type { ListWorkspaceFilesService } from '../../workspace-files';

export interface WorkspaceFilesHandlersOptions {
	listWorkspaceFilesService: ListWorkspaceFilesService;
}

/** Registers the IPC handler that lists repo files for composer @ mentions. */
export function registerWorkspaceFilesHandlers({
	listWorkspaceFilesService,
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
}
