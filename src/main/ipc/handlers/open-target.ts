import { ipcMain } from 'electron';

import type {
	ListWorkspaceOpenTargetsResult,
	OpenTargetResult,
	OpenWorkspaceInTargetRequest,
} from '@/shared/ipc/contracts/open-target';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { sanitizeWorkspaceRelativePath } from '../../open-target/open-target-paths';
import type { OpenTargetService } from '../../open-target/open-target-service';
import type { EnsemblrDatabaseService } from '../../storage';
import { getWorkspacePathById } from '../../storage/repositories/workspace-repository';

/** Dependencies for registering the "Open in…" IPC handlers. */
interface RegisterOpenTargetHandlersOptions {
	databaseService: EnsemblrDatabaseService;
	openTargetService: OpenTargetService;
}

/**
 * IPC handlers for the workbench "Open in…" menu. The list channel exposes
 * detected apps; the open channel resolves the workspace path from SQLite so
 * the renderer never has to round-trip the filesystem.
 */
export function registerOpenTargetHandlers({
	databaseService,
	openTargetService,
}: RegisterOpenTargetHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.listWorkspaceOpenTargets,
		async (): Promise<ListWorkspaceOpenTargetsResult> => {
			const targets = await openTargetService.listTargets();
			return { targets };
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.openWorkspaceInTarget,
		async (
			_event,
			request: OpenWorkspaceInTargetRequest,
		): Promise<OpenTargetResult> => {
			if (!request?.targetId || !request?.workspaceId) {
				return { ok: false, error: 'Missing targetId or workspaceId.' };
			}

			const database = databaseService.getConnection()?.database;
			if (!database) {
				return { ok: false, error: 'Database is not available.' };
			}

			const workspacePath = getWorkspacePathById({
				database,
				workspaceId: request.workspaceId,
			});
			if (!workspacePath) {
				console.warn('[open-target] workspace not found', request.workspaceId);
				return {
					ok: false,
					error: 'Workspace not found.',
				};
			}

			const relativePath = sanitizeWorkspaceRelativePath(request.relativePath);
			if (relativePath === null) {
				return { ok: false, error: 'Path must stay inside the workspace.' };
			}

			// Don't trust the renderer's kind: an unknown value would make terminal
			// and source-control targets open a file path instead of its parent dir.
			const relativePathKind =
				request.relativePathKind === 'file' ||
				request.relativePathKind === 'directory'
					? request.relativePathKind
					: undefined;

			return openTargetService.openTarget({
				targetId: request.targetId,
				workspacePath,
				...(relativePath ? { relativePath, relativePathKind } : {}),
			});
		},
	);
}
