/**
 * The merge close-out's base-branch step: resolves a merged workspace to the
 * repository and base branch it was cut from, and fast-forwards that branch in
 * the repository root unless the `updateBaseAfterMerge` setting turned it off.
 */

import type { SettingsResolutionSnapshot } from '../../shared/ipc/contracts/settings-resolution.ts';
import type { LocalBaseSyncOutcome } from '../../shared/workspace-merge.ts';
import type { LocalCommandService } from '../commands/local-command';
import { fastForwardLocalBase } from '../repository';
import { readStringColumns } from '../repository/row-guards.ts';
import type { EnsemblrDatabaseService } from '../storage';
import { selectWorkspaceWithRepositoryById } from '../storage/repositories/workspace-repository.ts';

/** The resolved setting that turns the step on or off. */
const UPDATE_BASE_AFTER_MERGE_KEY = 'updateBaseAfterMerge';

const MERGED_WORKSPACE_COLUMNS = [
	'baseBranch',
	'repositoryId',
	'repositoryPath',
] as const;

/** A repository's identity, as the settings resolver takes it. */
interface RepositoryIdentity {
	repositoryId: string;
	repositoryPath: string;
}

/** Collaborators the base-branch step reads through. */
export interface LocalBaseSyncDeps {
	databaseService: EnsemblrDatabaseService;
	localCommandService: LocalCommandService;
	resolveRepositorySettings: (
		repository: RepositoryIdentity,
	) => SettingsResolutionSnapshot;
}

/**
 * Builds the base-branch step the merge close-out runs for each merge.
 * @param deps - The database, command runner, and settings resolver.
 * @returns A function fast-forwarding one merged workspace's local base branch.
 */
export function createLocalBaseSync(
	deps: LocalBaseSyncDeps,
): (workspaceId: string) => Promise<LocalBaseSyncOutcome> {
	let lastSyncByRepository: ReadonlyMap<string, Promise<unknown>> = new Map();

	/**
	 * Runs one fast-forward after any still running in the same repository, so
	 * two merges landing together do not race each other for git's index lock.
	 * @param repositoryPath - The repository both syncs would move.
	 * @param sync - The fast-forward to run.
	 * @returns What the fast-forward did.
	 */
	const afterPreviousSync = (
		repositoryPath: string,
		sync: () => Promise<LocalBaseSyncOutcome>,
	): Promise<LocalBaseSyncOutcome> => {
		const previous = lastSyncByRepository.get(repositoryPath);
		const next = previous ? previous.then(sync, sync) : sync();
		lastSyncByRepository = new Map([
			...lastSyncByRepository,
			[repositoryPath, next],
		]);
		return next;
	};

	return async (workspaceId) => {
		const database = deps.databaseService.getConnection()?.database ?? null;
		const row = database
			? readStringColumns(
					selectWorkspaceWithRepositoryById({ database, workspaceId }),
					MERGED_WORKSPACE_COLUMNS,
				)
			: null;
		if (!row) {
			return {
				detail: `Workspace ${workspaceId} has no repository or base branch on record.`,
				status: 'unavailable',
			};
		}
		const repository = {
			repositoryId: row.repositoryId,
			repositoryPath: row.repositoryPath,
		};
		if (!isUpdateEnabled(deps.resolveRepositorySettings(repository))) {
			return { status: 'disabled' };
		}
		return afterPreviousSync(row.repositoryPath, () =>
			fastForwardLocalBase({
				baseBranch: row.baseBranch,
				localCommandService: deps.localCommandService,
				repositoryPath: row.repositoryPath,
			}),
		);
	};
}

/**
 * Reads whether the repository wants its base fast-forwarded after a merge. Any
 * value but an explicit `false` reads as on, matching the shipped default.
 * @param resolved - The repository's resolved settings.
 * @returns True unless the setting is off.
 */
function isUpdateEnabled(resolved: SettingsResolutionSnapshot): boolean {
	const value = resolved.repository?.settings.find(
		(setting) => setting.key === UPDATE_BASE_AFTER_MERGE_KEY,
	)?.value;
	return value !== false;
}
