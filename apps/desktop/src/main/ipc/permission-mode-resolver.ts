import type { DatabaseSync } from 'node:sqlite';

import type {
	SettingsResolutionRequest,
	SettingsResolutionSnapshot,
} from '../../shared/ipc/contracts/settings-resolution.ts';
import type { PermissionMode } from '../../shared/permissions.ts';
import type { EnsemblrDatabaseService } from '../storage/index.ts';
import {
	selectRepositoryPathById,
	selectWorkspaceIdByPath,
	selectWorkspaceWithRepositoryById,
} from '../storage/repositories/index.ts';
import {
	type PermissionModeContext,
	readPermissionModeFromSnapshot,
} from './permission-mode.ts';

/** Repository a request's permission mode is resolved against. */
interface RepositoryIdentity {
	repositoryId: string;
	repositoryPath?: string;
}

/** Dependencies of {@link createPermissionModeResolver}. */
interface CreatePermissionModeResolverOptions {
	databaseService: EnsemblrDatabaseService;
	resolveSettings: (
		request?: SettingsResolutionRequest,
	) => SettingsResolutionSnapshot;
}

/**
 * Builds the repository-aware permission-mode producer every gate reads. A
 * request names a workspace far more often than a repository, so the context is
 * narrowed to a repository here and the settings tree is resolved *with* it —
 * resolving without one yields an app-only snapshot, which is what left the
 * per-repository mode inert.
 *
 * Results are cached for the current macrotask only. A burst of gated calls
 * therefore costs one settings resolution, while a mode the user changes (in
 * the app or by hand in `config.json`) still applies to the very next turn of
 * the event loop.
 * @param options - Database service for the lookups and the settings resolver.
 * @returns A function from request context to the mode to enforce.
 */
export function createPermissionModeResolver({
	databaseService,
	resolveSettings,
}: CreatePermissionModeResolverOptions): (
	context: PermissionModeContext,
) => PermissionMode {
	const cache = new Map<string, PermissionMode>();
	let scheduledClear = false;

	const rememberForThisTick = (key: string, mode: PermissionMode): void => {
		cache.set(key, mode);
		if (scheduledClear) {
			return;
		}
		scheduledClear = true;
		setImmediate(() => {
			cache.clear();
			scheduledClear = false;
		});
	};

	return (context) => {
		const database = databaseService.getConnection()?.database ?? null;
		const repository = resolveRepositoryIdentity(database, context);
		const cacheKey = repository?.repositoryId ?? '';
		const cached = cache.get(cacheKey);

		if (cached) {
			return cached;
		}

		const mode = readPermissionModeFromSnapshot(
			resolveSettings(repository ? { repository } : undefined),
		);
		rememberForThisTick(cacheKey, mode);
		return mode;
	};
}

/**
 * Narrows a request context to the repository whose settings apply, preferring
 * an explicit repository id, then a workspace id, then a workspace checkout
 * path.
 * @param database - Open database handle, or `null` when none is available.
 * @param context - Identifiers carried by the request being gated.
 * @returns The repository to resolve against, or `null` when none matches.
 */
function resolveRepositoryIdentity(
	database: DatabaseSync | null,
	context: PermissionModeContext,
): RepositoryIdentity | null {
	if (!database) {
		return null;
	}

	const repositoryId = trimmed(context.repositoryId);
	if (repositoryId) {
		return {
			repositoryId,
			repositoryPath:
				selectRepositoryPathById({ database, id: repositoryId }) ?? undefined,
		};
	}

	const workspaceId =
		trimmed(context.workspaceId) ??
		workspaceIdForCwd(database, trimmed(context.workspaceCwd));

	return workspaceId ? repositoryForWorkspace(database, workspaceId) : null;
}

/**
 * Looks up the workspace registered at a checkout path.
 * @param database - Open database handle.
 * @param workspaceCwd - Absolute checkout path named by the request.
 * @returns The workspace id, or `null` when the path is unregistered.
 */
function workspaceIdForCwd(
	database: DatabaseSync,
	workspaceCwd: string | null,
): string | null {
	return workspaceCwd
		? selectWorkspaceIdByPath({ database, workspacePath: workspaceCwd })
		: null;
}

/**
 * Reads the repository a workspace belongs to, with the repository's checkout
 * path so a committed `.ensemblr/settings.toml` participates in resolution.
 * @param database - Open database handle.
 * @param workspaceId - Workspace named by the request.
 * @returns The repository identity, or `null` when the workspace is unknown.
 */
function repositoryForWorkspace(
	database: DatabaseSync,
	workspaceId: string,
): RepositoryIdentity | null {
	const row = selectWorkspaceWithRepositoryById({ database, workspaceId });

	if (!row || typeof row !== 'object') {
		return null;
	}

	const candidate = row as {
		repositoryId?: unknown;
		repositoryPath?: unknown;
	};

	return typeof candidate.repositoryId === 'string' && candidate.repositoryId
		? {
				repositoryId: candidate.repositoryId,
				repositoryPath:
					typeof candidate.repositoryPath === 'string'
						? candidate.repositoryPath
						: undefined,
			}
		: null;
}

/**
 * Trims an optional identifier, collapsing blanks to `null`.
 * @param value - Candidate identifier from the request payload.
 * @returns The trimmed value, or `null` when absent or blank.
 */
function trimmed(value: string | null | undefined): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}
