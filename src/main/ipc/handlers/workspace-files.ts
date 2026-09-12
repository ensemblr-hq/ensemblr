import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	ListWorkspaceFilesResult,
	ReadWorkspaceDirectoryResult,
	ReadWorkspaceFileResult,
	WriteWorkspaceActionPromptResult,
	WriteWorkspaceFileAttachmentResult,
	WriteWorkspaceImageAttachmentResult,
} from '../../../shared/ipc/contracts/workspace-files';
import type {
	ListWorkspaceFilesService,
	WorkspaceFilesWatcher,
} from '../../workspace-files';
import {
	readWorkspaceDirectoryRequestSchema,
	readWorkspaceFileRequestSchema,
	workspaceCwdRequestSchema,
	writeWorkspaceActionPromptRequestSchema,
	writeWorkspaceFileAttachmentRequestSchema,
	writeWorkspaceImageAttachmentRequestSchema,
} from '../request-schemas';

/**
 * Ceiling on concurrently watched workspaces. A recursive watch costs one
 * inotify watch per directory on Linux, so an unbounded loop of `watch` calls
 * would exhaust the host's watch limit and stall the main event loop; no user
 * has this many workspaces open at once.
 */
const MAX_WATCHED_WORKSPACES = 64;

/** Registers the IPC handlers that list, read, write attachments, and watch repo files. */
export function registerWorkspaceFilesHandlers({
	listWorkspaceFilesService,
	workspaceFilesWatcher,
}: {
	listWorkspaceFilesService: ListWorkspaceFilesService;
	workspaceFilesWatcher: WorkspaceFilesWatcher;
}): void {
	const watchedCwds = new Set<string>();
	ipcMain.handle(
		IPC_CHANNELS.listWorkspaceFiles,
		async (_event, raw: unknown): Promise<ListWorkspaceFilesResult> => {
			const parsed = workspaceCwdRequestSchema.safeParse(raw);
			return parsed.success
				? listWorkspaceFilesService.list(parsed.data)
				: {
						error: {
							code: 'invalid-cwd',
							message: 'Workspace file listing request was malformed.',
						},
						files: [],
					};
		},
	);
	ipcMain.handle(
		IPC_CHANNELS.readWorkspaceFile,
		async (_event, raw: unknown): Promise<ReadWorkspaceFileResult> => {
			const parsed = readWorkspaceFileRequestSchema.safeParse(raw);
			if (!parsed.success) {
				return {
					error: {
						code: 'invalid-path',
						message: 'Preview request was malformed.',
					},
					path: '',
				};
			}
			return listWorkspaceFilesService.read(parsed.data);
		},
	);
	ipcMain.handle(
		IPC_CHANNELS.readWorkspaceDirectory,
		async (_event, raw: unknown): Promise<ReadWorkspaceDirectoryResult> => {
			const parsed = readWorkspaceDirectoryRequestSchema.safeParse(raw);
			return parsed.success
				? listWorkspaceFilesService.readDirectory(parsed.data)
				: {
						entries: [],
						error: {
							code: 'invalid-path',
							message: 'Directory listing request was malformed.',
						},
						path: '',
					};
		},
	);
	ipcMain.handle(
		IPC_CHANNELS.writeWorkspaceImageAttachment,
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
	ipcMain.handle(
		IPC_CHANNELS.writeWorkspaceFileAttachment,
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
	ipcMain.handle(
		IPC_CHANNELS.writeWorkspaceActionPrompt,
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
		(_event, raw: unknown): void => {
			const parsed = workspaceCwdRequestSchema.safeParse(raw);

			if (parsed.success && watchedCwds.size < MAX_WATCHED_WORKSPACES) {
				watchedCwds.add(parsed.data.workspaceCwd);
				workspaceFilesWatcher.watch(parsed.data.workspaceCwd);
			}
		},
	);
	ipcMain.handle(
		IPC_CHANNELS.unwatchWorkspaceFiles,
		(_event, raw: unknown): void => {
			const parsed = workspaceCwdRequestSchema.safeParse(raw);

			if (parsed.success) {
				watchedCwds.delete(parsed.data.workspaceCwd);
				workspaceFilesWatcher.unwatch(parsed.data.workspaceCwd);
			}
		},
	);
}
