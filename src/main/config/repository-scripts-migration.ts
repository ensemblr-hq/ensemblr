/**
 * Moves a repository's personal script settings out of SQLite and into the
 * committed `.ensemblr/settings.toml`, which owns them from ADR 0041 onward.
 * Committed values win per key, which is exactly how the resolver already
 * ranked the two sources — so the migration cannot change what a repository
 * runs. Draining the rows is what makes the pass idempotent, so it can run at
 * every launch and a repository that failed once still gets another chance.
 */
import type { DatabaseSync } from 'node:sqlite';

import {
	type RunScriptDefinition,
	type RunScriptMode,
	readConfiguredRunScripts,
} from '../../shared/scripts.ts';
import type { NormalizedScope } from '../environment/environment-variable-types.ts';
import {
	deleteSetting,
	readSettingJson,
} from '../environment/settings-table.ts';
import { selectLiveRepositoryPaths } from '../storage/repositories/repository-row-repository.ts';
import { withTransaction } from '../storage/tx.ts';
import { isPlainRecord } from './json-utils.ts';
import { loadRepositoryConfig } from './repository-config.ts';
import { writeRepositoryScripts } from './repository-scripts-writer.ts';

/** Repository-scoped SQLite keys the Scripts screen used to own. */
const LEGACY_SETTING_KEYS = [
	'autoRunAfterSetup',
	'runScriptMode',
	'scripts.archive',
	'scripts.run',
	'scripts.runScripts',
	'scripts.setup',
] as const;

/**
 * Migrates every live repository that still has personal script rows. The pass
 * needs no "already ran" marker: a migrated repository has had its rows deleted,
 * so the next run skips it on its own. That keeps a repository whose checkout
 * was unwritable — or archived at the time — retryable on the next launch,
 * instead of stranding its rows behind a flag it can never clear.
 * @param database - Database handle.
 * @returns The ids of the repositories that were migrated.
 */
export function migrateAllRepositoryScriptSettings(
	database: DatabaseSync,
): string[] {
	const migrated: string[] = [];

	for (const repository of selectLiveRepositoryPaths({ database })) {
		if (migrateOneRepository(database, repository) === 'migrated') {
			migrated.push(repository.id);
		}
	}

	return migrated;
}

/**
 * Migrates one repository, turning a throw or a write failure into a logged
 * outcome so the surrounding pass continues. A failure leaves the rows in place
 * and is retried on the next launch.
 * @param database - Database handle.
 * @param repository - The repository's id and root clone path.
 * @returns The outcome status.
 */
function migrateOneRepository(
	database: DatabaseSync,
	repository: { id: string; path: string },
): MigrateRepositoryScriptSettingsOutcome['status'] {
	try {
		const outcome = migrateRepositoryScriptSettings({
			database,
			repositoryId: repository.id,
			repositoryPath: repository.path,
		});

		if (outcome.status === 'failed') {
			console.error(
				'[repository-scripts] could not migrate',
				repository.path,
				outcome.message,
			);
		}

		return outcome.status;
	} catch (error) {
		console.error(
			'[repository-scripts] could not migrate',
			repository.path,
			error,
		);

		return 'failed';
	}
}

/** Inputs for {@link migrateRepositoryScriptSettings}. */
export interface MigrateRepositoryScriptSettingsInput {
	database: DatabaseSync;
	repositoryId: string;
	/** Absolute path of the repository's root clone. */
	repositoryPath: string;
}

/** What the migration did for one repository. */
export type MigrateRepositoryScriptSettingsOutcome =
	| { message: string; status: 'failed' }
	| { status: 'migrated' }
	| { status: 'skipped' };

/**
 * Folds a repository's personal script rows into its committed config and drops
 * the rows. Repositories with no such rows are left alone, so the pass never
 * writes a file it has nothing to add to. The rows are deleted only after the
 * file write succeeds, leaving a failed migration retryable.
 * @param input - Database handle, repository id, and its root clone path.
 * @returns Whether the repository was migrated, skipped, or failed.
 */
export function migrateRepositoryScriptSettings({
	database,
	repositoryId,
	repositoryPath,
}: MigrateRepositoryScriptSettingsInput): MigrateRepositoryScriptSettingsOutcome {
	const scope: NormalizedScope = { scope: 'repository', scopeId: repositoryId };
	const personal = readPersonalSettings(database, scope);

	if (personal.size === 0) {
		return { status: 'skipped' };
	}

	const committed = readCommittedSettings(repositoryPath);
	const resolve = (key: string): unknown =>
		committed.get(key) ?? personal.get(key);

	const result = writeRepositoryScripts({
		archive: asCommand(resolve('scripts.archive')),
		autoRunAfterSetup: asBoolean(resolve('autoRunAfterSetup')),
		repositoryPath,
		runScriptMode: asRunScriptMode(resolve('runScriptMode')),
		runScripts: resolveRunScripts(resolve),
		setup: asCommand(resolve('scripts.setup')),
	});

	if (!result.ok) {
		return { message: result.message, status: 'failed' };
	}

	withTransaction(database, () => {
		for (const key of LEGACY_SETTING_KEYS) {
			deleteSetting({ database, key, scope });
		}
	});

	return { status: 'migrated' };
}

/**
 * Reads the personal script rows that are actually present, so an absent key
 * stays distinguishable from one persisted as `false` or an empty string.
 * @param database - Database handle.
 * @param scope - Repository scope the rows belong to.
 * @returns The present keys and their decoded values.
 */
function readPersonalSettings(
	database: DatabaseSync,
	scope: NormalizedScope,
): Map<string, unknown> {
	const settings = new Map<string, unknown>();

	for (const key of LEGACY_SETTING_KEYS) {
		const raw = readSettingJson({ database, key, scope });

		if (raw === null) {
			continue;
		}

		try {
			settings.set(key, JSON.parse(raw));
		} catch {}
	}

	return settings;
}

/**
 * Reads the script settings the committed config already declares, keyed the
 * same way as the personal rows so the two can be merged by key.
 * @param repositoryPath - Absolute path of the repository's root clone.
 * @returns The declared keys and their normalised values.
 */
function readCommittedSettings(repositoryPath: string): Map<string, unknown> {
	const config = loadRepositoryConfig({ repositoryPath }).ensemblrConfig ?? {};
	const scripts = isPlainRecord(config.scripts) ? config.scripts : {};
	const settings = new Map<string, unknown>();
	const declared: [string, unknown][] = [
		['autoRunAfterSetup', config.autoRunAfterSetup],
		['runScriptMode', config.runScriptMode],
		['scripts.archive', scripts.archive],
		['scripts.run', scripts.run],
		['scripts.runScripts', scripts.runScripts],
		['scripts.setup', scripts.setup],
	];

	for (const [key, value] of declared) {
		if (value !== undefined) {
			settings.set(key, value);
		}
	}

	return settings;
}

/**
 * Resolves the merged run scripts through the shared parser, so a legacy
 * single-command row becomes the same implicit script the dock already offers.
 * @param resolve - Per-key lookup over the merged settings.
 * @returns The run scripts to write.
 */
function resolveRunScripts(
	resolve: (key: string) => unknown,
): RunScriptDefinition[] {
	return readConfiguredRunScripts([
		{ key: 'scripts.run', value: resolve('scripts.run') },
		{ key: 'scripts.runScripts', value: resolve('scripts.runScripts') },
	]);
}

/**
 * Narrows a stored value to a script command, treating blanks as unconfigured.
 * @param value - Merged value for a command key.
 * @returns The command, or null.
 */
function asCommand(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * Narrows a stored value to a boolean, so a mistyped row leaves the key unset
 * rather than pinning a value the user never chose.
 * @param value - Merged value for a boolean key.
 * @returns The boolean, or null.
 */
function asBoolean(value: unknown): boolean | null {
	return typeof value === 'boolean' ? value : null;
}

/**
 * Narrows a stored value to a run mode, leaving the key unset when it is
 * neither supported spelling.
 * @param value - Merged value for `runScriptMode`.
 * @returns The run mode, or null.
 */
function asRunScriptMode(value: unknown): RunScriptMode | null {
	if (value === 'concurrent' || value === 'nonconcurrent') {
		return value;
	}

	return null;
}
