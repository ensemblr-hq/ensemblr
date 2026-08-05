import type { DatabaseSync } from 'node:sqlite';

import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	EnsureWorkspaceSetupRequest,
	EnsureWorkspaceSetupResult,
	RunWorkspaceScriptRequest,
	RunWorkspaceScriptResult,
	StopWorkspaceScriptRequest,
	StopWorkspaceScriptResult,
	UpdateRepositoryScriptsResult,
} from '../../../shared/ipc/contracts/workspace-scripts';
import {
	isRepositoryConfigPathAllowed,
	writeRepositoryScripts,
} from '../../config';
import type { ScriptLifecycleService } from '../../scripts';
import type { EnsemblrDatabaseService } from '../../storage';
import { selectRepositoryPathById } from '../../storage/repositories/repository-row-repository.ts';
import { parseUpdateRepositoryScriptsRequest } from '../request-schemas.ts';

/**
 * Registers the IPC handlers that run and stop repository setup/run/archive
 * scripts inside workspace terminal sessions, plus the Scripts-settings writer
 * that rewrites the repository's committed `.ensemblr/settings.toml`.
 * @param options - Required services.
 */
export function registerWorkspaceScriptHandlers({
	databaseService,
	scriptLifecycleService,
}: {
	databaseService: EnsemblrDatabaseService;
	scriptLifecycleService: ScriptLifecycleService;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.ensureWorkspaceSetup,
		(
			_event,
			request: EnsureWorkspaceSetupRequest,
		): Promise<EnsureWorkspaceSetupResult> =>
			scriptLifecycleService.runSetupScriptIfNeeded({
				workspaceId: request.workspaceId,
			}),
	);

	ipcMain.handle(
		IPC_CHANNELS.runWorkspaceScript,
		(
			_event,
			request: RunWorkspaceScriptRequest,
		): Promise<RunWorkspaceScriptResult> =>
			scriptLifecycleService.runScript({
				kind: request.kind,
				restart: request.restart,
				scriptName: request.scriptName,
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
		(_event, request: unknown): UpdateRepositoryScriptsResult =>
			saveRepositoryScripts(databaseService, request),
	);
}

/**
 * Rewrites a repository's committed `.ensemblr/settings.toml` from a Scripts
 * settings save, reporting a no-op rather than throwing when the payload, the
 * database, or the repository cannot be resolved.
 * @param databaseService - Database service providing the active connection.
 * @param request - Raw IPC payload from the Scripts settings screen.
 * @returns Whether the committed config was rewritten.
 */
function saveRepositoryScripts(
	databaseService: EnsemblrDatabaseService,
	request: unknown,
): UpdateRepositoryScriptsResult {
	const parsed = parseUpdateRepositoryScriptsRequest(request);
	const database = databaseService.getConnection()?.database ?? null;

	if (!parsed || !database) {
		return { ok: false };
	}

	const repositoryPath = resolveWritableRepositoryPath(
		database,
		parsed.repositoryId,
	);

	if (!repositoryPath) {
		console.error(
			'[workspace-scripts] no known repository for',
			parsed.repositoryId,
		);

		return { ok: false };
	}

	const result = writeRepositoryScripts({ ...parsed, repositoryPath });

	if (!result.ok) {
		console.error(
			'[workspace-scripts] failed to write repository script settings',
			result.message,
		);
	}

	return { ok: result.ok };
}

/**
 * Resolves the root clone a Scripts save may write to, refusing any id that
 * does not map to a repository path the app already tracks.
 * @param database - Active database connection.
 * @param repositoryId - Repository the save targets.
 * @returns The writable root path, or null.
 */
function resolveWritableRepositoryPath(
	database: DatabaseSync,
	repositoryId: string,
): string | null {
	const repositoryPath = selectRepositoryPathById({
		database,
		id: repositoryId,
	});

	return repositoryPath &&
		isRepositoryConfigPathAllowed({ database, repositoryPath })
		? repositoryPath
		: null;
}
