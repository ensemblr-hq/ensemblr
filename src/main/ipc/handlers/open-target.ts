import { basename, dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { ipcMain } from 'electron';

import type {
	ListWorkspaceOpenTargetsResult,
	OpenSettingsFileInTargetRequest,
	OpenTargetResult,
	OpenWorkspaceInTargetRequest,
	SettingsConfigFile,
} from '@/shared/ipc/contracts/open-target';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type { AppSettingsService } from '../../config';
import { isRepositoryConfigPathAllowed } from '../../config';
import { ensureRepositoryConfigFile } from '../../config/repository-config-file.ts';
import type { OpenTargetService } from '../../open-target';
import { sanitizeWorkspaceRelativePath } from '../../open-target/open-target-paths';
import type { EnsemblrDatabaseService } from '../../storage';
import { getWorkspacePathById } from '../../storage/repositories/workspace-repository';

/**
 * IPC handlers for the workbench "Open in…" menu. The list channel exposes
 * detected apps; the workspace channel resolves the workspace path from SQLite,
 * and the settings channel resolves the config.json / settings.toml path — both
 * so the renderer never has to round-trip the filesystem. All three share the
 * same detected-target registry.
 */
export function registerOpenTargetHandlers({
	appSettingsService,
	databaseService,
	openTargetService,
}: {
	appSettingsService: AppSettingsService;
	databaseService: EnsemblrDatabaseService;
	openTargetService: OpenTargetService;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.listWorkspaceOpenTargets,
		async (): Promise<ListWorkspaceOpenTargetsResult> => {
			const targets = await openTargetService.listTargets();
			return { targets };
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.openSettingsFileInTarget,
		async (
			_event,
			request: OpenSettingsFileInTargetRequest,
		): Promise<OpenTargetResult> => {
			if (!request?.targetId || !request?.config) {
				return { ok: false, error: 'Missing targetId or config.' };
			}

			const filePath = resolveSettingsConfigPath(
				request.config,
				appSettingsService,
				databaseService.getConnection()?.database ?? null,
			);
			if (!filePath) {
				return {
					ok: false,
					error: 'Could not resolve the settings file path.',
				};
			}

			// Pass the file as a `file`-kind sub-path of its own directory so the
			// shared resolver opens the containing folder for terminal /
			// source-control targets and the file itself for editors / Finder.
			return openTargetService.openTarget({
				relativePath: basename(filePath),
				relativePathKind: 'file',
				targetId: request.targetId,
				workspacePath: dirname(filePath),
			});
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

/**
 * Resolves the absolute path of the settings file an "Edit in…" action targets,
 * creating it if missing. User scope reads the app-settings service path; repo
 * scope ensures the committed `.ensemblr/settings.toml` for the given repo, but
 * only after the path is confirmed against the tracked repository/workspace
 * allowlist so an arbitrary absolute path cannot trigger a config-file write.
 * @param config - Which settings file to resolve.
 * @param appSettingsService - Service owning the user `config.json` path.
 * @param database - Active SQLite connection used for the allowlist check.
 * @returns The absolute file path, or `null` when it cannot be resolved.
 */
function resolveSettingsConfigPath(
	config: SettingsConfigFile,
	appSettingsService: AppSettingsService,
	database: DatabaseSync | null,
): string | null {
	if (config.scope === 'user') {
		appSettingsService.ensureExists();
		return appSettingsService.getPath();
	}

	const repositoryPath =
		typeof config.repositoryPath === 'string'
			? config.repositoryPath.trim()
			: '';
	if (
		!repositoryPath ||
		!isRepositoryConfigPathAllowed({ database, repositoryPath })
	) {
		return null;
	}

	try {
		return ensureRepositoryConfigFile(repositoryPath);
	} catch {
		return null;
	}
}
