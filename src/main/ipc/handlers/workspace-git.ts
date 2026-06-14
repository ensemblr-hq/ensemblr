import { ipcMain } from 'electron';

import {
	type GetWorkspaceFileDiffResult,
	type GetWorkspaceGitStatusResult,
	IPC_CHANNELS,
} from '../../../shared/ipc';
import type { WorkspaceGitService } from '../../workspace-git';
import {
	getWorkspaceFileDiffRequestSchema,
	getWorkspaceGitStatusRequestSchema,
} from '../request-schemas.ts';

export interface WorkspaceGitHandlersOptions {
	workspaceGitService: WorkspaceGitService;
}

/** Registers IPC handlers for workspace git status and per-file diffs. */
export function registerWorkspaceGitHandlers({
	workspaceGitService,
}: WorkspaceGitHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.getWorkspaceGitStatus,
		(_event, raw: unknown): Promise<GetWorkspaceGitStatusResult> =>
			workspaceGitService.getStatus(
				getWorkspaceGitStatusRequestSchema.parse(raw),
			),
	);
	ipcMain.handle(
		IPC_CHANNELS.getWorkspaceFileDiff,
		(_event, raw: unknown): Promise<GetWorkspaceFileDiffResult> =>
			workspaceGitService.getFileDiff(
				getWorkspaceFileDiffRequestSchema.parse(raw),
			),
	);
}
