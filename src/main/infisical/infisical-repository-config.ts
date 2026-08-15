/**
 * Reads and writes the `[infisical]` block of a repository's committed
 * `.ensemblr/settings.toml`. The block names the *project* — instance URL,
 * project id, environment, path — so a teammate who clones the repository is
 * already pointed at the right secrets. It never carries a credential: which
 * local account resolves it is per-machine state held in SQLite.
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { dump } from 'js-toml';

import { formatErrorMessage, isPlainRecord } from '../config/json-utils.ts';
import {
	ENSEMBLR_DIRECTORY,
	ENSEMBLR_SETTINGS_FILENAME,
} from '../config/repository-config.ts';
import { readTomlFile } from '../config/repository-config-loaders.ts';

/** TOML table this module owns. */
const INFISICAL_TABLE_KEY = 'infisical';

/**
 * `[infisical]` keys this module rewrites. Anything else in the table is a key
 * the app does not model and survives the rewrite untouched.
 */
const MANAGED_INFISICAL_KEYS: ReadonlySet<string> = new Set([
	'environment',
	'path',
	'project_id',
	'project_name',
	'recursive',
	'site_url',
]);

/** The project half of a link, as committed to the repository. */
export interface InfisicalRepositoryConfigBlock {
	environmentSlug: string;
	projectId: string;
	projectName: string | null;
	recursive: boolean;
	secretPath: string;
	siteUrl: string | null;
}

/** Outcome of a committed-config write, carrying a message the caller can log. */
export type WriteInfisicalConfigResult =
	| { message: string; ok: false }
	| { ok: true; path: string };

/**
 * Reads the committed `[infisical]` block for a repository.
 * @param repositoryPath - Absolute path of the repository.
 * @returns The block, or null when the repository declares none or the config
 * does not parse.
 */
export function readInfisicalRepositoryConfig(
	repositoryPath: string,
): InfisicalRepositoryConfigBlock | null {
	const existing = readTomlFile({ sourcePath: configPathFor(repositoryPath) });

	if (existing.status !== 'loaded' || !existing.record) {
		return null;
	}

	const table = existing.record[INFISICAL_TABLE_KEY];

	if (!isPlainRecord(table)) {
		return null;
	}

	const projectId = readString(table, 'project_id');
	const environmentSlug = readString(table, 'environment');

	if (!projectId || !environmentSlug) {
		return null;
	}

	return {
		environmentSlug,
		projectId,
		projectName: readString(table, 'project_name'),
		recursive: table.recursive === true,
		secretPath: readString(table, 'path') ?? '/',
		siteUrl: readString(table, 'site_url'),
	};
}

/**
 * Rewrites a repository's committed `[infisical]` block. A config that does not
 * parse is left untouched rather than clobbered, so a hand-edit mistake never
 * costs the user their file.
 * @param input - The repository and the block to commit (null clears the block).
 * @returns The written path, or the reason the write did not happen.
 */
export function writeInfisicalRepositoryConfig({
	block,
	repositoryPath,
}: {
	block: InfisicalRepositoryConfigBlock | null;
	repositoryPath: string;
}): WriteInfisicalConfigResult {
	const configPath = configPathFor(repositoryPath);
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
	const nextTable = buildInfisicalTable(
		isPlainRecord(record[INFISICAL_TABLE_KEY])
			? record[INFISICAL_TABLE_KEY]
			: {},
		block,
	);

	try {
		writeTomlFile(configPath, withInfisicalTable(record, nextTable));

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
 * Composes the config record with its next `[infisical]` table, dropping the
 * table entirely when nothing is left in it.
 * @param record - The full config record already on disk.
 * @param table - The next `[infisical]` table.
 * @returns The record to serialise.
 */
function withInfisicalTable(
	record: Record<string, unknown>,
	table: Record<string, unknown>,
): Record<string, unknown> {
	if (Object.keys(table).length === 0) {
		const { [INFISICAL_TABLE_KEY]: _removed, ...rest } = record;

		return rest;
	}

	return { ...record, [INFISICAL_TABLE_KEY]: table };
}

/**
 * Folds a link into the `[infisical]` table, keeping keys the app does not
 * model. A null block removes every managed key, leaving the repository
 * unlinked for everyone who clones it.
 * @param existing - The `[infisical]` table already on disk.
 * @param block - The link to commit, or null to clear it.
 * @returns The next `[infisical]` table.
 */
function buildInfisicalTable(
	existing: Record<string, unknown>,
	block: InfisicalRepositoryConfigBlock | null,
): Record<string, unknown> {
	const unmanaged = Object.fromEntries(
		Object.entries(existing).filter(
			([key]) => !MANAGED_INFISICAL_KEYS.has(key),
		),
	);

	if (!block) {
		return unmanaged;
	}

	return {
		...unmanaged,
		environment: block.environmentSlug,
		path: block.secretPath || '/',
		project_id: block.projectId,
		...(block.projectName ? { project_name: block.projectName } : {}),
		...(block.recursive ? { recursive: true } : {}),
		...(block.siteUrl ? { site_url: block.siteUrl } : {}),
	};
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
 * Resolves the committed config path for a repository.
 * @param repositoryPath - Absolute path of the repository.
 * @returns Absolute path of `.ensemblr/settings.toml`.
 */
function configPathFor(repositoryPath: string): string {
	return path.join(
		repositoryPath,
		ENSEMBLR_DIRECTORY,
		ENSEMBLR_SETTINGS_FILENAME,
	);
}

/**
 * Reads a non-empty string key off a TOML table.
 * @param table - The parsed table.
 * @param key - Key to read.
 * @returns The trimmed value, or null when absent, non-string, or empty.
 */
function readString(
	table: Record<string, unknown>,
	key: string,
): string | null {
	const value = table[key];

	return typeof value === 'string' && value.trim() ? value.trim() : null;
}
