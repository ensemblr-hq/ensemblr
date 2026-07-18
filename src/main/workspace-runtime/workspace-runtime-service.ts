import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
	ActivateWorkspaceDesktopAppResult,
	WorkspaceDesktopRuntime,
} from '../../shared/ipc/contracts/workspace-runtime.ts';
import { parseWorkspaceScriptSettings } from '../../shared/scripts/script-settings.ts';
import type { LocalCommandService } from '../commands/local-command.ts';
import type { EnsemblrConfigResolutionService } from '../config';
import { isRecord, isString } from '../repository/row-guards.ts';
import type { EnsemblrDatabaseService } from '../storage';
import { selectWorkspaceWithRepositoryById } from '../storage/repositories/workspace-repository.ts';
import { detectDesktopRuntime } from './detect-desktop-runtime.ts';

const OPEN_BINARY_PATH = '/usr/bin/open';
const OPEN_TIMEOUT_MS = 5000;

/** Dependencies the workspace-runtime service needs to resolve and act on a workspace. */
interface CreateWorkspaceRuntimeServiceOptions {
	databaseService: EnsemblrDatabaseService;
	localCommandService: LocalCommandService;
	settingsResolutionService: EnsemblrConfigResolutionService;
}

/** Detects desktop toolchains and focuses their windows for the dock's Launch button. */
export interface WorkspaceRuntimeService {
	/** Focuses (or launches) the workspace's desktop app window on macOS. */
	activateDesktopApp: (
		workspaceId: string,
	) => Promise<ActivateWorkspaceDesktopAppResult>;
	/** Detects the desktop runtime for a workspace, or `null` for web/server projects. */
	detectDesktopRuntime: (workspaceId: string) => WorkspaceDesktopRuntime | null;
}

/**
 * Builds the service backing the dock's Launch button: it resolves a
 * workspace's on-disk manifest and run command, decides whether the project is
 * an Electron/Tauri desktop app, and focuses the running window on request.
 * @param options - Database, settings resolver, and local-command runner.
 * @returns A {@link WorkspaceRuntimeService}.
 */
export function createWorkspaceRuntimeService({
	databaseService,
	localCommandService,
	settingsResolutionService,
}: CreateWorkspaceRuntimeServiceOptions): WorkspaceRuntimeService {
	/** Resolves a workspace's on-disk path plus its configured run command. */
	function resolveWorkspaceContext(
		workspaceId: string,
	): { path: string; runCommand: string | null } | null {
		const database = databaseService.getConnection()?.database ?? null;

		if (!database) {
			return null;
		}

		const row = selectWorkspaceWithRepositoryById({ database, workspaceId });

		if (!isWorkspaceRow(row)) {
			return null;
		}

		const snapshot = settingsResolutionService.resolve({
			repository: { repositoryId: row.repositoryId, repositoryPath: row.path },
		});
		const settings = parseWorkspaceScriptSettings(
			snapshot.repository?.settings ?? [],
		);

		return { path: row.path, runCommand: settings.scripts.run ?? null };
	}

	function detect(workspaceId: string): WorkspaceDesktopRuntime | null {
		const context = resolveWorkspaceContext(workspaceId);

		if (!context) {
			return null;
		}

		return detectDesktopRuntime({
			packageJson: readJsonFile(join(context.path, 'package.json')),
			runCommand: context.runCommand,
			tauriConf: readJsonFile(
				join(context.path, 'src-tauri', 'tauri.conf.json'),
			),
		});
	}

	async function activateDesktopApp(
		workspaceId: string,
	): Promise<ActivateWorkspaceDesktopAppResult> {
		if (process.platform !== 'darwin') {
			return { ok: false, error: 'Focusing the app window is macOS-only.' };
		}

		const runtime = detect(workspaceId);

		if (!runtime?.appName) {
			return {
				ok: false,
				error: 'The desktop app name could not be resolved.',
			};
		}

		const result = await localCommandService.run(
			{
				args: ['-a', runtime.appName],
				command: OPEN_BINARY_PATH,
				timeoutMs: OPEN_TIMEOUT_MS,
			},
			undefined,
		);

		if (result.status !== 'success') {
			return {
				ok: false,
				error: result.failure?.message ?? `Failed to focus ${runtime.appName}.`,
			};
		}

		return { ok: true };
	}

	return { activateDesktopApp, detectDesktopRuntime: detect };
}

/** Reads and parses a JSON file, returning `null` when absent or malformed. */
function readJsonFile(filePath: string): unknown {
	try {
		return JSON.parse(readFileSync(filePath, 'utf8'));
	} catch {
		return null;
	}
}

/** Type guard for the workspace row fields this service reads. */
function isWorkspaceRow(
	row: unknown,
): row is { path: string; repositoryId: string } {
	return isRecord(row) && isString(row.path) && isString(row.repositoryId);
}
