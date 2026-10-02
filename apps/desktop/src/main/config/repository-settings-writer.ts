/**
 * Reads and rewrites a repository's committed `.ensemblr/settings.toml`. Every
 * section that persists there — `[scripts]`, `[infisical]` — goes through this
 * module, so the rules that protect the file are stated once: a config that
 * does not parse is left untouched rather than clobbered, and the replacement
 * is atomic so a crash mid-write cannot leave a half-written config behind.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { dump } from 'js-toml';

import { writeFileAtomicExclusive } from '../safe-fs/index.ts';
import { formatErrorMessage } from './json-utils.ts';
import { readTomlFile } from './repository-config-loaders.ts';
import {
	assertSafeSettingsPath,
	settingsFilePath,
} from './settings-file-access.ts';

/** Taplo's schema directive, which must be the first line of the document. */
const SCHEMA_DIRECTIVE_PATTERN = /^#:schema[ \t]+\S+$/;

/** Outcome of a rewrite, carrying a message the caller can surface on failure. */
export type WriteRepositorySettingsResult =
	| { message: string; ok: false }
	| { ok: true; path: string };

/**
 * Reports whether a repository has a committed settings file at all, without
 * caring whether it parses. A caller that clears a section checks this to tell
 * "nothing was ever committed here" — where a rewrite would *create* the file —
 * apart from "the file exists but is broken", which must still be written
 * through so the failure is reported rather than swallowed.
 * @param repositoryPath - Absolute path of the repository.
 * @returns True when `.ensemblr/settings.toml` exists.
 */
export function hasRepositorySettingsFile(repositoryPath: string): boolean {
	return existsSync(settingsFilePath(repositoryPath));
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
		sourcePath: settingsFilePath(repositoryPath),
	});

	return parsed.status === 'loaded' ? parsed.record : null;
}

/**
 * Rewrites a repository's committed settings by passing the record already on
 * disk through `rewrite`. Sections the callback leaves alone survive the
 * round-trip; comments do not, because the file is re-serialised whole — except
 * a leading `#:schema` directive, which is restored above the document.
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
	const configPath = settingsFilePath(repositoryPath);
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
		writeTomlFile(
			configPath,
			rewrite(existing.record ?? {}),
			readSchemaDirective(configPath),
		);

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
 * Reads back the `#:schema` directive a hand-written config opens with, so the
 * rewrite below can restore it. Every other comment is lost to re-serialisation;
 * this one is what points an editor at the published schema, so losing it would
 * silently disable validation for everyone who clones the repository.
 * @param configPath - Absolute path of the config file.
 * @returns The directive line, or null when the file has none.
 */
function readSchemaDirective(configPath: string): string | null {
	let firstLine: string;

	try {
		firstLine = readFileSync(configPath, 'utf8').split('\n', 1).at(0) ?? '';
	} catch {
		return null;
	}

	const directive = firstLine.trimEnd();

	return SCHEMA_DIRECTIVE_PATTERN.test(directive) ? directive : null;
}

/**
 * Serialises a config record and replaces the file atomically, so a crash
 * mid-write cannot leave a half-written config the loader would reject.
 *
 * The destination is inside the repository checkout, so a repository can commit
 * a symlink at any level of it. Each level is refused before the write, and the
 * staging file carries a random name opened exclusively — the fixed
 * `settings.toml.tmp` this used to write was itself plantable, and following it
 * left the repository permanently aliased to the link's target.
 * @param configPath - Absolute path of the config file.
 * @param record - The full config record to serialise.
 * @param schemaDirective - The `#:schema` line to restore above the document.
 */
function writeTomlFile(
	configPath: string,
	record: Record<string, unknown>,
	schemaDirective: string | null,
): void {
	const document = dump(record);
	const serialized = schemaDirective
		? `${schemaDirective}\n\n${document}`
		: document;
	const repositoryPath = path.dirname(path.dirname(configPath));

	assertSafeSettingsPath(repositoryPath);
	mkdirSync(path.dirname(configPath), { mode: 0o700, recursive: true });
	assertSafeSettingsPath(repositoryPath);
	writeFileAtomicExclusive(configPath, serialized);
}
