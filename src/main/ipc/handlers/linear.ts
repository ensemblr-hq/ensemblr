import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { type LinearConnectionSnapshot, type LinearDisconnectResult, type LinearLoginResult } from '../../../shared/ipc/contracts/linear';
import type { LinearAuthService, LinearService } from '../../linear';
import {
	createLinearCommentRequestSchema,
	createLinearIssueRequestSchema,
	getLinearIssueRequestSchema,
	getLinearMetadataRequestSchema,
	listLinearIssuesRequestSchema,
	updateLinearIssueRequestSchema,
} from '../request-schemas.ts';

/** Service dependencies used by the Linear integration IPC handlers. */
export interface LinearHandlersOptions {
	linearAuthService: LinearAuthService;
	linearService: LinearService;
}

/**
 * Registers IPC handlers for the Linear OAuth lifecycle and issue data.
 * @param options - Required services.
 */
export function registerLinearHandlers({
	linearAuthService,
	linearService,
}: LinearHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.linearConnectionStatus,
		(): Promise<LinearConnectionSnapshot> => {
			return linearAuthService.getConnectionStatus();
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.linearStartLogin,
		(): Promise<LinearLoginResult> => {
			return linearAuthService.startLogin();
		},
	);

	ipcMain.handle(IPC_CHANNELS.linearCancelLogin, (): Promise<void> => {
		return linearAuthService.cancelLogin();
	});

	ipcMain.handle(
		IPC_CHANNELS.linearDisconnect,
		(): Promise<LinearDisconnectResult> => {
			return linearAuthService.disconnect();
		},
	);

	ipcMain.handle(IPC_CHANNELS.linearListIssues, (_event, raw: unknown) => {
		return linearService.listIssues(listLinearIssuesRequestSchema.parse(raw));
	});

	ipcMain.handle(IPC_CHANNELS.linearGetIssue, (_event, raw: unknown) => {
		return linearService.getIssue(getLinearIssueRequestSchema.parse(raw));
	});

	ipcMain.handle(IPC_CHANNELS.linearMetadata, (_event, raw: unknown) => {
		return linearService.getMetadata(getLinearMetadataRequestSchema.parse(raw));
	});

	ipcMain.handle(IPC_CHANNELS.linearCreateIssue, (_event, raw: unknown) => {
		return linearService.createIssue(createLinearIssueRequestSchema.parse(raw));
	});

	ipcMain.handle(IPC_CHANNELS.linearUpdateIssue, (_event, raw: unknown) => {
		return linearService.updateIssue(updateLinearIssueRequestSchema.parse(raw));
	});

	ipcMain.handle(IPC_CHANNELS.linearCreateComment, (_event, raw: unknown) => {
		return linearService.createComment(
			createLinearCommentRequestSchema.parse(raw),
		);
	});
}
