import { ipcMain } from 'electron';

import type {
	ActivateWorkspaceDesktopAppRequest,
	ActivateWorkspaceDesktopAppResult,
	DetectWorkspaceDesktopRuntimeRequest,
	DetectWorkspaceDesktopRuntimeResult,
} from '@/shared/ipc/contracts/workspace-runtime';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { WorkspaceRuntimeService } from '../../workspace-runtime';

/**
 * IPC handlers for desktop-runtime detection and window focus. The detect
 * channel tells the dock whether to show a Launch button; the activate channel
 * focuses the already-running app window (macOS `open -a`).
 */
export function registerWorkspaceRuntimeHandlers({
	workspaceRuntimeService,
}: {
	workspaceRuntimeService: WorkspaceRuntimeService;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.detectWorkspaceDesktopRuntime,
		(
			_event,
			request: DetectWorkspaceDesktopRuntimeRequest,
		): DetectWorkspaceDesktopRuntimeResult => {
			if (!request?.workspaceId) {
				return { runtime: null };
			}

			return {
				runtime: workspaceRuntimeService.detectDesktopRuntime(
					request.workspaceId,
				),
			};
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.activateWorkspaceDesktopApp,
		(
			_event,
			request: ActivateWorkspaceDesktopAppRequest,
		): Promise<ActivateWorkspaceDesktopAppResult> => {
			if (!request?.workspaceId) {
				return Promise.resolve({
					ok: false,
					error: 'Missing workspaceId.',
				});
			}

			return workspaceRuntimeService.activateDesktopApp(request.workspaceId);
		},
	);
}
