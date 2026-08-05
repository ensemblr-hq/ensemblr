/**
 * Writes the repository Scripts settings back into the committed
 * `.ensemblr/settings.toml`, which is their sole store (ADR 0041). The rewrite
 * is whole-file: values in other sections survive, comments do not.
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { dump } from 'js-toml';

import {
	DEFAULT_RUN_SCRIPT_ICON,
	type RunScriptDefinition,
	type RunScriptMode,
} from '../../shared/scripts.ts';
import { formatErrorMessage, isPlainRecord } from './json-utils.ts';
import {
	ENSEMBLR_DIRECTORY,
	ENSEMBLR_SETTINGS_FILENAME,
} from './repository-config.ts';
import { readTomlFile } from './repository-config-loaders.ts';

/**
 * The Scripts settings screen's fields, plus the repository they belong to.
 * `autoRunAfterSetup` and `runScriptMode` accept null to leave their keys out
 * of the file entirely, so a caller that does not know the user's intent cannot
 * accidentally pin a value that would shadow a user-level default.
 */
export interface WriteRepositoryScriptsInput {
	archive: string | null;
	autoRunAfterSetup: boolean | null;
	/** Absolute path of the repository whose committed config is rewritten. */
	repositoryPath: string;
	runScriptMode: RunScriptMode | null;
	runScripts: readonly RunScriptDefinition[];
	setup: string | null;
}

/** Outcome of a write, carrying a message the IPC layer can log on failure. */
export type WriteRepositoryScriptsResult =
	| { ok: true; path: string }
	| { message: string; ok: false };

/**
 * `[scripts]` keys this module owns. Anything else in the table is a key the
 * app does not model and is carried through the rewrite untouched.
 */
const MANAGED_SCRIPT_KEYS: ReadonlySet<string> = new Set([
	'archive',
	'auto_run_after_setup',
	'run',
	'run_mode',
	'setup',
]);

/**
 * Rewrites a repository's committed `.ensemblr/settings.toml` so its `[scripts]`
 * block matches the Scripts settings screen. A config that does not parse is
 * left untouched rather than clobbered, so a hand-edit mistake never costs the
 * user their file.
 * @param input - The edited script settings and the repository they belong to.
 * @returns The written path, or the reason the write did not happen.
 */
export function writeRepositoryScripts(
	input: WriteRepositoryScriptsInput,
): WriteRepositoryScriptsResult {
	const configPath = path.join(
		input.repositoryPath,
		ENSEMBLR_DIRECTORY,
		ENSEMBLR_SETTINGS_FILENAME,
	);
	const existing = readTomlFile({ sourcePath: configPath });

	if (existing.status === 'invalid') {
		return {
			message:
				existing.diagnostics.at(0)?.message ??
				'.ensemblr/settings.toml could not be read.',
			ok: false,
		};
	}

	const record = existing.record ?? {};

	try {
		writeTomlFile(configPath, {
			...record,
			scripts: buildScriptsTable(asScriptsTable(record.scripts), input),
		});

		return { ok: true, path: configPath };
	} catch (error) {
		return {
			message: formatErrorMessage(
				error,
				'Failed to write .ensemblr/settings.toml.',
			),
			ok: false,
		};
	}
}

/**
 * Serialises a config record and replaces the file atomically, so a crash
 * mid-write cannot leave a half-written config the loader would reject.
 * @param configPath - Absolute path of the config file.
 * @param record - The full config record to serialise.
 */
function writeTomlFile(
	configPath: string,
	record: Record<string, unknown>,
): void {
	const temporaryPath = `${configPath}.tmp`;

	mkdirSync(path.dirname(configPath), { recursive: true });
	writeFileSync(temporaryPath, dump(record), 'utf8');
	renameSync(temporaryPath, configPath);
}

/**
 * Folds the edited settings into the `[scripts]` table, keeping keys the app
 * does not model. Every managed key whose input is null is left out, so the
 * setting falls back to the next source in the resolver.
 * @param existing - The `[scripts]` table already on disk.
 * @param input - The edited script settings.
 * @returns The next `[scripts]` table.
 */
function buildScriptsTable(
	existing: Record<string, unknown>,
	input: WriteRepositoryScriptsInput,
): Record<string, unknown> {
	const setup = trimmedCommand(input.setup);
	const archive = trimmedCommand(input.archive);
	const run = buildRunTable(input.runScripts);

	return {
		...omitManagedKeys(existing),
		...(setup ? { setup } : {}),
		...(archive ? { archive } : {}),
		...(run ? { run } : {}),
		...(input.autoRunAfterSetup === null
			? {}
			: { auto_run_after_setup: input.autoRunAfterSetup }),
		...(input.runScriptMode ? { run_mode: input.runScriptMode } : {}),
	};
}

/**
 * Builds the `[scripts.run.<name>]` tables, replacing whatever the `run` key
 * held before — including a legacy single-command string, which the settings
 * screen has already surfaced as a named script.
 * @param scripts - The edited run scripts, in display order.
 * @returns The `run` table, or null when the repository declares none.
 */
function buildRunTable(
	scripts: readonly RunScriptDefinition[],
): Record<string, unknown> | null {
	if (scripts.length === 0) {
		return null;
	}

	const table: Record<string, unknown> = {};

	for (const script of scripts) {
		table[script.name] = {
			command: script.command,
			...(script.icon === DEFAULT_RUN_SCRIPT_ICON ? {} : { icon: script.icon }),
			...(script.isDefault ? { default: true } : {}),
			...(script.availableIn ? { available_in: [...script.availableIn] } : {}),
		};
	}

	return table;
}

/**
 * Drops the keys this module rewrites, so the caller can re-add them without
 * leaving a stale spelling behind.
 * @param existing - The `[scripts]` table already on disk.
 * @returns The keys the app does not model.
 */
function omitManagedKeys(
	existing: Record<string, unknown>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(existing).filter(([key]) => !MANAGED_SCRIPT_KEYS.has(key)),
	);
}

/**
 * Reads a script command, treating a blank one as unconfigured so its key is
 * removed rather than written as an empty string.
 * @param value - Raw command from the settings screen.
 * @returns The trimmed command, or null.
 */
function trimmedCommand(value: string | null): string | null {
	return value?.trim() || null;
}

/**
 * Narrows the existing `scripts` value to a table, treating anything else as
 * absent.
 * @param value - Raw `scripts` value read from the config.
 * @returns The table, or an empty one.
 */
function asScriptsTable(value: unknown): Record<string, unknown> {
	return isPlainRecord(value) ? value : {};
}
