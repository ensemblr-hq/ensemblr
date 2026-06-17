import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	DiscardWorkspaceChangesResult,
	GetWorkspaceCommitsResult,
	GetWorkspaceFileDiffResult,
	GetWorkspaceGitStatusResult,
} from '../../../shared/ipc/contracts/workspace-git';
import type { WorkspaceGitService } from '../../workspace-git';
import {
	discardWorkspaceChangesRequestSchema,
	getWorkspaceCommitsRequestSchema,
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
	ipcMain.handle(
		IPC_CHANNELS.getWorkspaceCommits,
		(_event, raw: unknown): Promise<GetWorkspaceCommitsResult> =>
			workspaceGitService.getCommits(
				getWorkspaceCommitsRequestSchema.parse(raw),
			),
	);
	ipcMain.handle(
		IPC_CHANNELS.discardWorkspaceChanges,
		(_event, raw: unknown): Promise<DiscardWorkspaceChangesResult> =>
			workspaceGitService.discardChanges(
				discardWorkspaceChangesRequestSchema.parse(raw),
			),
	);
}
