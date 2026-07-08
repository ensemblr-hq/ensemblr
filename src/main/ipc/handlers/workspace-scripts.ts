import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	RunWorkspaceScriptRequest,
	RunWorkspaceScriptResult,
	StopWorkspaceScriptRequest,
	StopWorkspaceScriptResult,
	UpdateRepositoryScriptsResult,
} from '../../../shared/ipc/contracts/workspace-scripts';
import { upsertRepositoryScriptSettings } from '../../environment/repository-script-settings.ts';
import type { ScriptLifecycleService } from '../../scripts';
import type { EnsembleDatabaseService } from '../../storage';
import { parseUpdateRepositoryScriptsRequest } from '../request-schemas.ts';

/** Service dependencies used by the workspace-script IPC handlers. */
export interface WorkspaceScriptHandlersOptions {
	databaseService: EnsembleDatabaseService;
	scriptLifecycleService: ScriptLifecycleService;
}

/**
 * Registers the IPC handlers that run and stop repository setup/run/archive
 * scripts inside workspace terminal sessions, plus the Scripts-settings writer
 * that persists personal script overrides to SQLite.
 * @param options - Required services.
 */
export function registerWorkspaceScriptHandlers({
	databaseService,
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

	ipcMain.handle(
		IPC_CHANNELS.updateRepositoryScripts,
		(_event, request: unknown): UpdateRepositoryScriptsResult => {
			const parsed = parseUpdateRepositoryScriptsRequest(request);
			const database = databaseService.getConnection()?.database;

			if (!parsed || !database) {
				return { ok: false };
			}

			try {
				upsertRepositoryScriptSettings({ database, ...parsed });

				return { ok: true };
			} catch (error) {
				console.error(
					'[workspace-scripts] failed to persist repository script settings',
					error,
				);

				return { ok: false };
			}
		},
	);
}
