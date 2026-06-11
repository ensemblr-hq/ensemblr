import { ipcMain } from 'electron';

import {
	IPC_CHANNELS,
	type RunWorkspaceScriptRequest,
	type RunWorkspaceScriptResult,
	type StopWorkspaceScriptRequest,
	type StopWorkspaceScriptResult,
} from '../../../shared/ipc';
import type { ScriptLifecycleService } from '../../scripts';

/** Service dependencies used by the workspace-script IPC handlers. */
export interface WorkspaceScriptHandlersOptions {
	scriptLifecycleService: ScriptLifecycleService;
}

/**
 * Registers the IPC handlers that run and stop repository setup/run/archive
 * scripts inside workspace terminal sessions.
 * @param options - Required services.
 */
export function registerWorkspaceScriptHandlers({
	scriptLifecycleService,
}: WorkspaceScriptHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.runWorkspaceScript,
		(
			_event,
			request: RunWorkspaceScriptRequest,
		): Promise<RunWorkspaceScriptResult> =>
			scriptLifecycleService.runScript({
				kind: request.kind,
				restart: request.restart,
				workspaceId: request.workspaceId,
			}),
	);

	ipcMain.handle(
		IPC_CHANNELS.stopWorkspaceScript,
		(
			_event,
			request: StopWorkspaceScriptRequest,
		): Promise<StopWorkspaceScriptResult> =>
			scriptLifecycleService.stopScript({
				kind: request.kind,
				workspaceId: request.workspaceId,
			}),
	);
}
