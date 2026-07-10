/**
 * Pure file-loading primitives shared by `repository-config.ts`. Reads
 * `.ensemblr/settings.toml` and `.worktreeinclude` files and surfaces parse/IO
 * errors as diagnostics. Normalization, snapshot wrapping, and orchestration
 * live in `repository-config.ts`.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { load } from 'js-toml';

import type { ConfigDiagnostic } from '../../shared/ipc/contracts/health';
import type { RepositoryConfigSourceStatus } from '../../shared/ipc/contracts/repository-config';
import type { SettingsResolutionSource } from '../../shared/ipc/contracts/settings-resolution';
import { formatErrorMessage } from './json-utils.ts';

/** Filename of the `.worktreeinclude` legacy include list. */
export const WORKTREE_INCLUDE_FILENAME = '.worktreeinclude';

/** Result of reading a single config file from disk. */
interface ParsedConfigSource {
	diagnostics: ConfigDiagnostic[];
	path: string;
	record: Record<string, unknown> | null;
	status: RepositoryConfigSourceStatus;
}

/**
 * Maps a settings source identifier to its on-disk filename for diagnostics.
 */
export function formatSourceName(source: SettingsResolutionSource): string {
	if (source === 'ensemblr-config') {
		return '.ensemblr/settings.toml';
	}

	if (source === 'worktreeinclude') {
		return '.worktreeinclude';
	}

	return source;
}

/** Pre-parse outcome of {@link readSourceFile}. */
type ReadSourceFileOutcome =
	| { kind: 'missing'; rawSource?: undefined }
	| { kind: 'read-error'; rawSource?: undefined; readError: unknown }
	| { kind: 'loaded'; rawSource: string };

/**
 * Reads a source file from disk and reports IO-level outcomes (missing vs
 * read-error vs loaded). Parsing is left to the caller.
 */
function readSourceFile(sourcePath: string): ReadSourceFileOutcome {
	if (!existsSync(sourcePath)) {
		return { kind: 'missing' };
	}

	try {
		return { kind: 'loaded', rawSource: readFileSync(sourcePath, 'utf8') };
	} catch (error) {
		return { kind: 'read-error', readError: error };
	}
}

/**
 * Reads a TOML file from disk and reports parse/IO errors as diagnostics.
 */
export function readTomlFile({
	sourcePath,
}: {
	sourcePath: string;
}): ParsedConfigSource {
	const outcome = readSourceFile(sourcePath);

	if (outcome.kind === 'missing') {
		return {
			diagnostics: [],
			path: sourcePath,
			record: null,
			status: 'missing',
		};
	}

	if (outcome.kind === 'read-error') {
		return {
			diagnostics: [
				{
					code: 'repository-config-read-error',
					message: formatErrorMessage(
						outcome.readError,
						'Failed to read TOML config file.',
					),
					severity: 'error',
				},
			],
			path: sourcePath,
			record: null,
			status: 'invalid',
		};
	}

	try {
		return {
			diagnostics: [],
			path: sourcePath,
			record: load(outcome.rawSource) as Record<string, unknown> | null,
			status: 'loaded',
		};
	} catch (error) {
		return {
			diagnostics: [
				{
					code: 'invalid-repository-toml',
					message: formatErrorMessage(
						error,
						'.ensemblr/settings.toml is not valid TOML.',
					),
					severity: 'error',
				},
			],
			path: sourcePath,
			record: null,
			status: 'invalid',
		};
	}
}

/**
 * Parses a `.worktreeinclude` file (one path per line) into a `filesToCopy`
 * setting, skipping blanks and `#`-prefixed comments.
 */
export function loadWorktreeincludeSource(repositoryPath: string): {
	diagnostics: ConfigDiagnostic[];
	settings: Record<string, unknown>;
	status: RepositoryConfigSourceStatus;
} {
	const sourcePath = path.join(repositoryPath, WORKTREE_INCLUDE_FILENAME);

	if (!existsSync(sourcePath)) {
		return { diagnostics: [], settings: {}, status: 'missing' };
	}

	let source: string;

	try {
		source = readFileSync(sourcePath, 'utf8');
	} catch (error) {
		return {
			diagnostics: [
				{
					code: 'repository-config-read-error',
					message: formatErrorMessage(
						error,
						'Failed to read .worktreeinclude.',
					),
					severity: 'error',
				},
			],
			settings: {},
			status: 'invalid',
		};
	}

	const filesToCopy = source
		.split(/\r?\n/)
		.map((line) => line.trim())
		.flatMap((line) => {
			if (!line || line.startsWith('#')) {
				return [];
			}

			return [line.startsWith('\\#') ? line.slice(1) : line];
		});

	return {
		diagnostics: [],
		settings: { filesToCopy },
		status: 'loaded',
	};
}
