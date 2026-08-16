/**
 * Reads and rewrites a repository's committed `.ensemblr/settings.toml`. Every
 * section that persists there — `[scripts]`, `[infisical]` — goes through this
 * module, so the rules that protect the file are stated once: a config that
 * does not parse is left untouched rather than clobbered, and the replacement
 * is atomic so a crash mid-write cannot leave a half-written config behind.
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { dump } from 'js-toml';

import { formatErrorMessage } from './json-utils.ts';
import {
	ENSEMBLR_DIRECTORY,
	ENSEMBLR_SETTINGS_FILENAME,
} from './repository-config.ts';
import { readTomlFile } from './repository-config-loaders.ts';

/** Outcome of a rewrite, carrying a message the caller can surface on failure. */
export type WriteRepositorySettingsResult =
	| { message: string; ok: false }
	| { ok: true; path: string };

/**
 * Resolves the committed settings path for a repository.
 * @param repositoryPath - Absolute path of the repository.
 * @returns Absolute path of its `.ensemblr/settings.toml`.
 */
function repositorySettingsPath(repositoryPath: string): string {
	return path.join(
		repositoryPath,
		ENSEMBLR_DIRECTORY,
		ENSEMBLR_SETTINGS_FILENAME,
	);
}

/**
 * Reads a repository's committed settings record.
 * @param repositoryPath - Absolute path of the repository.
 * @returns The parsed record, or null when the file is absent or does not parse.
 */
export function readRepositorySettings(
	repositoryPath: string,
): Record<string, unknown> | null {
	const parsed = readTomlFile({
		sourcePath: repositorySettingsPath(repositoryPath),
	});

	return parsed.status === 'loaded' ? parsed.record : null;
}

/**
 * Rewrites a repository's committed settings by passing the record already on
 * disk through `rewrite`. Sections the callback leaves alone survive the
 * round-trip; comments do not, because the file is re-serialised whole.
 * @param input - The repository, and the transform to apply to its record.
 * @returns The written path, or the reason the write did not happen.
 */
export function rewriteRepositorySettings({
	repositoryPath,
	rewrite,
}: {
	repositoryPath: string;
	rewrite: (record: Record<string, unknown>) => Record<string, unknown>;
}): WriteRepositorySettingsResult {
	const configPath = repositorySettingsPath(repositoryPath);
	const existing = readTomlFile({ sourcePath: configPath });

	if (existing.status === 'invalid') {
		return {
			message:
				existing.diagnostics.at(0)?.message ??
				'.ensemblr/settings.toml could not be read.',
			ok: false,
		};
	}

	try {
		writeTomlFile(configPath, rewrite(existing.record ?? {}));

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
