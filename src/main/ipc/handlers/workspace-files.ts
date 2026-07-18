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
	WriteWorkspaceActionPromptResult,
	WriteWorkspaceFileAttachmentResult,
	WriteWorkspaceImageAttachmentResult,
} from '../../../shared/ipc/contracts/workspace-files';
import type {
	ListWorkspaceFilesService,
	WorkspaceFilesWatcher,
} from '../../workspace-files';
import type { WithPermissionGate } from '../permission-gate';
import {
	writeWorkspaceActionPromptRequestSchema,
	writeWorkspaceFileAttachmentRequestSchema,
	writeWorkspaceImageAttachmentRequestSchema,
} from '../request-schemas';

/** Registers the IPC handlers that list, read, write attachments, and watch repo files. */
export function registerWorkspaceFilesHandlers({
	listWorkspaceFilesService,
	workspaceFilesWatcher,
	withPermissionGate,
}: {
	listWorkspaceFilesService: ListWorkspaceFilesService;
	workspaceFilesWatcher: WorkspaceFilesWatcher;
	withPermissionGate: WithPermissionGate;
}): void {
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
	withPermissionGate(
		IPC_CHANNELS.writeWorkspaceImageAttachment,
		'workspace-write',
		async (
			_event,
			raw: unknown,
		): Promise<WriteWorkspaceImageAttachmentResult> => {
			try {
				const request = writeWorkspaceImageAttachmentRequestSchema.parse(raw);
				return listWorkspaceFilesService.writeImageAttachment(request);
			} catch (cause) {
				return {
					error: {
						code: 'invalid-image',
						message:
							cause instanceof Error
								? cause.message
								: 'Invalid pasted image payload.',
					},
				};
			}
		},
	);
	withPermissionGate(
		IPC_CHANNELS.writeWorkspaceFileAttachment,
		'workspace-write',
		async (
			_event,
			raw: unknown,
		): Promise<WriteWorkspaceFileAttachmentResult> => {
			try {
				const request = writeWorkspaceFileAttachmentRequestSchema.parse(raw);
				return listWorkspaceFilesService.writeFileAttachment(request);
			} catch (cause) {
				return {
					error: {
						code: 'invalid-attachment',
						message:
							cause instanceof Error
								? cause.message
								: 'Invalid pasted attachment payload.',
					},
				};
			}
		},
	);
	withPermissionGate(
		IPC_CHANNELS.writeWorkspaceActionPrompt,
		'workspace-write',
		async (_event, raw: unknown): Promise<WriteWorkspaceActionPromptResult> => {
			try {
				const request = writeWorkspaceActionPromptRequestSchema.parse(raw);
				return listWorkspaceFilesService.writeActionPrompt(request);
			} catch (cause) {
				return {
					error: {
						code: 'invalid-attachment',
						message:
							cause instanceof Error
								? cause.message
								: 'Invalid action prompt payload.',
					},
				};
			}
		},
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
