import { ipcMain } from 'electron';
import type { AppLanguage } from '../../../shared/i18n.ts';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	OpenRepositoryConfigFileRequest,
	OpenRepositoryConfigFileResult,
	UpdateRepositorySettingsResult,
} from '../../../shared/ipc/contracts/repository-settings';
import {
	classifyPermissionAction,
	type PermissionMode,
} from '../../../shared/permissions.ts';
import { isRepositoryConfigPathAllowed } from '../../config';
import { openInEditor } from '../../config/open-in-editor.ts';
import { ensureRepositoryConfigFile } from '../../config/repository-config-file.ts';
import { upsertRepositorySettings } from '../../environment/repository-settings.ts';
import type { EnsemblrDatabaseService } from '../../storage';
import { confirmPermissionAction } from '../permission-gate.ts';
import type { PermissionModeContext } from '../permission-mode.ts';
import { parseUpdateRepositorySettingsRequest } from '../request-schemas.ts';

/**
 * Registers the IPC handler that persists personal repository settings (Git and
 * Misc screens) to repository-scoped SQLite rows the settings resolver reads.
 *
 * This channel is deliberately absent from the central permission table: the
 * patch it carries can hold `security.permissionMode`, so a mode-derived gate
 * would let a `read-only` repository lock the user out of the very screen that
 * relaxes it. It enforces its own rule instead — a mode change always asks the
 * user, and every other field is gated as an app-settings change.
 * @param options - Required services.
 */
export function registerRepositorySettingsHandlers({
	databaseService,
	getLanguage,
	resolvePermissionMode,
}: {
	databaseService: EnsemblrDatabaseService;
	getLanguage: () => AppLanguage;
	resolvePermissionMode: (context: PermissionModeContext) => PermissionMode;
}): void {
	ipcMain.handle(
		IPC_CHANNELS.updateRepositorySettings,
		async (
			_event,
			request: unknown,
		): Promise<UpdateRepositorySettingsResult> =>
			(await approveRepositorySettingsWrite({
				getLanguage,
				request,
				resolvePermissionMode,
			}))
				? persistRepositorySettings(databaseService, request)
				: { ok: false },
	);

	ipcMain.handle(
		IPC_CHANNELS.openRepositoryConfigFile,
		(
			_event,
			request: OpenRepositoryConfigFileRequest,
		): Promise<OpenRepositoryConfigFileResult> =>
			openRepositoryConfig(databaseService, request),
	);
}

/**
 * Decides whether a repository-settings patch may be written. A patch touching
 * the permission mode always needs a native approval, because that field is the
 * one an attacker would widen to unlock everything else; any other patch is
 * classified as an app-settings change against the repository's current mode.
 * @param options - Language reader, the raw patch, and the mode resolver.
 * @returns True when the write may proceed.
 */
async function approveRepositorySettingsWrite({
	getLanguage,
	request,
	resolvePermissionMode,
}: {
	getLanguage: () => AppLanguage;
	request: unknown;
	resolvePermissionMode: (context: PermissionModeContext) => PermissionMode;
}): Promise<boolean> {
	const parsed = parseUpdateRepositorySettingsRequest(request);

	if (!parsed) {
		return false;
	}

	const mode = resolvePermissionMode({ repositoryId: parsed.repositoryId });

	if (parsed.settings.permissionMode !== undefined) {
		return confirmPermissionAction({
			action: 'app-settings-change',
			language: getLanguage(),
		});
	}

	const boundary = classifyPermissionAction({
		action: 'app-settings-change',
		mode,
	}).boundary;

	if (boundary === 'blocked') {
		return false;
	}

	return boundary === 'allowed' || mode === 'workspace-trusted'
		? true
		: confirmPermissionAction({
				action: 'app-settings-change',
				language: getLanguage(),
			});
}

/**
 * Validates and persists a repository-settings patch to SQLite, returning
 * `{ ok: false }` for malformed input, a closed database, or a write error.
 * @param databaseService - Database service providing the active connection.
 * @param request - Raw IPC payload.
 * @returns The write result.
 */
function persistRepositorySettings(
	databaseService: EnsemblrDatabaseService,
	request: unknown,
): UpdateRepositorySettingsResult {
	const parsed = parseUpdateRepositorySettingsRequest(request);
	const database = databaseService.getConnection()?.database;

	if (!parsed || !database) {
		return { ok: false };
	}

	try {
		upsertRepositorySettings({
			database,
			repositoryId: parsed.repositoryId,
			settings: parsed.settings,
		});
		return { ok: true };
	} catch (error) {
		console.error(
			'[repository-settings] failed to persist repository settings',
			error,
		);
		return { ok: false };
	}
}

/**
 * Ensures the repo's committed config exists and opens it in the user's editor.
 * The renderer-supplied path is gated against the tracked repository/workspace
 * allowlist so an arbitrary absolute path cannot trigger a config-file write.
 * @param databaseService - Database service providing the active connection.
 * @param request - Request carrying the repository path.
 * @returns The open result, with `error` set when it could not be opened.
 */
async function openRepositoryConfig(
	databaseService: EnsemblrDatabaseService,
	request: OpenRepositoryConfigFileRequest,
): Promise<OpenRepositoryConfigFileResult> {
	const repositoryPath =
		typeof request?.repositoryPath === 'string'
			? request.repositoryPath.trim()
			: '';

	if (!repositoryPath) {
		return { error: 'A repository path is required to open its config.' };
	}

	const database = databaseService.getConnection()?.database ?? null;
	if (!isRepositoryConfigPathAllowed({ database, repositoryPath })) {
		return {
			error:
				'Repository config can only be opened for a known repository or workspace path.',
		};
	}

	try {
		return await openInEditor(ensureRepositoryConfigFile(repositoryPath));
	} catch (error) {
		return {
			error:
				error instanceof Error
					? error.message
					: 'Failed to open the repository config file.',
		};
	}
}
