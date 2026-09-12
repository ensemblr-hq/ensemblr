/**
 * Reads and drains the personal script settings a pre-ADR-0041 Ensemblr kept in
 * SQLite. The launch-time pass that wrote them straight into the repository's
 * root clone is gone: a root write lands on no branch and in no diff, so
 * retained rows now travel through the settings publication flow, which folds
 * them into the file it writes onto a workspace branch and drains them only
 * once that write has been verified. Committed values still win per key, which
 * is how the resolver already ranked the two sources.
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
import { withTransaction } from '../storage/tx.ts';
import { isPlainRecord } from './json-utils.ts';
import { loadRepositoryConfig } from './repository-config.ts';
import type { writeRepositoryScripts } from './repository-scripts-writer.ts';

/** Repository-scoped SQLite keys the Scripts screen used to own. */
const LEGACY_SETTING_KEYS = [
	'autoRunAfterSetup',
	'runScriptMode',
	'scripts.archive',
	'scripts.run',
	'scripts.runScripts',
	'scripts.setup',
] as const;

/** Inputs for {@link readPendingRepositoryScripts}. */
export interface ReadPendingRepositoryScriptsInput {
	database: DatabaseSync;
	repositoryId: string;
	/** Absolute path of the checkout holding the candidate config. */
	repositoryPath: string;
}

/** Legacy script values ready to fold into a workspace config preview. */
export type PendingRepositoryScripts = Omit<
	Parameters<typeof writeRepositoryScripts>[0],
	'repositoryPath'
>;

/**
 * Reads retained SQLite script settings and merges them with the supplied
 * config without mutating either source. Existing file values win per key.
 * @param input - Database identity and path containing the candidate config.
 * @returns Settings for the writer, or null when no legacy rows remain.
 */
export function readPendingRepositoryScripts({
	database,
	repositoryId,
	repositoryPath,
}: ReadPendingRepositoryScriptsInput): PendingRepositoryScripts | null {
	const scope: NormalizedScope = { scope: 'repository', scopeId: repositoryId };
	const personal = readPersonalSettings(database, scope);

	if (personal.size === 0) {
		return null;
	}

	const committed = readCommittedSettings(repositoryPath);

	return {
		archive: asCommand(
			committed.get('scripts.archive') ?? personal.get('scripts.archive'),
		),
		autoRunAfterSetup: asBoolean(
			committed.get('autoRunAfterSetup') ?? personal.get('autoRunAfterSetup'),
		),
		runScriptMode: asRunScriptMode(
			committed.get('runScriptMode') ?? personal.get('runScriptMode'),
		),
		runScripts: resolveRunScripts(committed, personal),
		setup: asCommand(
			committed.get('scripts.setup') ?? personal.get('scripts.setup'),
		),
	};
}

/**
 * Deletes the retained SQLite script rows for one repository. Call this only
 * after the values have been written somewhere durable and that write has been
 * verified, since nothing else in the app can reproduce them afterwards.
 * @param input - Database handle and the repository whose rows to drop.
 */
export function dropRetainedRepositoryScripts({
	database,
	repositoryId,
}: {
	database: DatabaseSync;
	repositoryId: string;
}): void {
	const scope: NormalizedScope = { scope: 'repository', scopeId: repositoryId };

	withTransaction(database, () => {
		for (const key of LEGACY_SETTING_KEYS) {
			deleteSetting({ database, key, scope });
		}
	});
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
		} catch (error) {
			console.warn(
				'[repository-scripts] ignored malformed retained setting',
				key,
				error instanceof Error ? error.message : 'JSON parse failed',
			);
		}
	}

	return settings;
}

/**
 * Reads the script settings the committed config already declares, keyed the
 * same way as the personal rows so the two can be merged by key.
 * @param repositoryPath - Absolute path of the checkout to read the committed
 * `.ensemblr/settings.toml` from — the publication flow's temporary directory
 * during a publish, or a repository's root clone during the legacy migration.
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
 * @param committed - Script settings declared in the committed config.
 * @param personal - Script settings declared in personal overrides.
 * @returns The run scripts to write.
 */
function resolveRunScripts(
	committed: ReadonlyMap<string, unknown>,
	personal: ReadonlyMap<string, unknown>,
): RunScriptDefinition[] {
	return readConfiguredRunScripts([
		{
			key: 'scripts.run',
			value: committed.get('scripts.run') ?? personal.get('scripts.run'),
		},
		{
			key: 'scripts.runScripts',
			value:
				committed.get('scripts.runScripts') ??
				personal.get('scripts.runScripts'),
		},
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
