import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type {
	FilesToCopyDiagnostic,
	FilesToCopyEntry,
	FilesToCopySnapshot,
	FilesToCopySource,
} from '../../shared/ipc/contracts/workspace';
import type { LocalCommandService } from '../commands/local-command';
import type { LoadedRepositoryConfig } from '../config';

/** Public surface of the files-to-copy service. */
export interface FilesToCopyService {
	copy: (input: CopyFilesToWorkspaceInput) => Promise<FilesToCopySnapshot>;
}

/** Input for a single files-to-copy run. */
interface CopyFilesToWorkspaceInput {
	config: LoadedRepositoryConfig;
	/**
	 * Personal (SQLite) files-to-copy patterns resolved for the repo. When set,
	 * they override the committed default but stay below `.worktreeinclude` and
	 * `.ensemblr/settings.toml`, matching the settings resolver's precedence.
	 */
	personalPatterns?: readonly string[];
	repositoryPath: string;
	workspacePath: string;
}

const DEFAULT_PATTERNS: readonly string[] = ['.env*'];
const LS_FILES_TIMEOUT_MS = 15_000;
const LS_FILES_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * Builds the service that resolves a repository's effective files-to-copy
 * patterns, asks git which gitignored files match, and copies them into a
 * freshly-created workspace.
 * @param options - Service dependencies.
 * @returns A {@link FilesToCopyService}.
 */
export function createFilesToCopyService({
	localCommandService,
}: {
	localCommandService: LocalCommandService;
}): FilesToCopyService {
	return {
		copy: async (input) => {
			const resolved = resolveFilesToCopyPatterns(
				input.config,
				input.personalPatterns,
			);

			if (resolved.patterns.length === 0) {
				return emptySnapshot(resolved.source, resolved.patterns);
			}

			const listed = await listFilesToCopyMatches({
				cwd: input.repositoryPath,
				localCommandService,
				patterns: resolved.patterns,
			});

			if (listed.error !== null) {
				return {
					copied: [],
					diagnostics: [
						{
							code: 'pattern-listing-failed',
							message: listed.error,
							severity: 'warning',
						},
					],
					patterns: resolved.patterns,
					skipped: [],
					source: resolved.source,
				};
			}

			const copied: FilesToCopyEntry[] = [];
			const skipped: FilesToCopyDiagnostic[] = [];
			const diagnostics: FilesToCopyDiagnostic[] = [];

			for (const relativePath of listed.relativePaths) {
				const from = path.join(input.repositoryPath, relativePath);
				const to = path.join(input.workspacePath, relativePath);

				const outcome = copyOneFile(from, to);
				if (outcome.status === 'copied') {
					copied.push({ from, relativePath, to });
				} else if (outcome.status === 'failed') {
					diagnostics.push({
						code: 'copy-failed',
						message: outcome.message,
						path: relativePath,
						severity: 'warning',
					});
				} else {
					skipped.push({
						code: 'source-path-missing',
						message:
							outcome.status === 'missing'
								? `Source path ${relativePath} no longer exists; skipped.`
								: `Source path ${relativePath} is not a regular file; skipped.`,
						path: relativePath,
						severity: 'info',
					});
				}
			}

			return {
				copied,
				diagnostics,
				patterns: resolved.patterns,
				skipped,
				source: resolved.source,
			};
		},
	};
}

/** Outcome of enumerating files-to-copy candidates in one tree. */
export interface FilesToCopyMatches {
	/** Why the enumeration failed, or null when it succeeded. */
	error: string | null;
	/** Matching paths, relative to `cwd`. */
	relativePaths: string[];
}

/**
 * Asks git which gitignored files in `cwd` match the resolved patterns.
 *
 * Exported because the archive prune enumerates the same set in the *workspace*
 * — to preserve a locally-edited `.env` before the worktree is removed — while
 * workspace creation enumerates it in the repository root.
 * @param cwd - Tree to enumerate.
 * @param localCommandService - Command runner used for git.
 * @param patterns - Resolved files-to-copy patterns.
 * @returns The matching relative paths, or the failure that stopped the listing.
 */
export async function listFilesToCopyMatches({
	cwd,
	localCommandService,
	patterns,
}: {
	cwd: string;
	localCommandService: LocalCommandService;
	patterns: readonly string[];
}): Promise<FilesToCopyMatches> {
	if (patterns.length === 0) {
		return { error: null, relativePaths: [] };
	}

	const tmpDirectory = mkdtempSync(
		path.join(tmpdir(), 'ensemblr-files-to-copy-'),
	);
	const patternsPath = path.join(tmpDirectory, 'patterns');

	try {
		writeFileSync(patternsPath, `${patterns.join('\n')}\n`, 'utf8');

		const result = await localCommandService.run({
			args: [
				'ls-files',
				'-z',
				'--others',
				'--ignored',
				`--exclude-from=${patternsPath}`,
			],
			command: 'git',
			cwd,
			maxOutputBytes: LS_FILES_MAX_OUTPUT_BYTES,
			timeoutMs: LS_FILES_TIMEOUT_MS,
		});

		if (result.status !== 'success') {
			return {
				error:
					firstLine(result.stderr) ||
					'git ls-files failed to enumerate files-to-copy candidates.',
				relativePaths: [],
			};
		}

		return { error: null, relativePaths: parseNullSeparated(result.stdout) };
	} finally {
		try {
			rmSync(tmpDirectory, { force: true, recursive: true });
		} catch {
			// Best effort: temp scratch left behind on next OS cleanup.
		}
	}
}

/**
 * What copying one candidate produced. `missing` and `not-a-file` are expected
 * absences the caller reports as skips; `failed` carries the throw.
 */
export type CopyOneOutcome =
	| { status: 'copied' }
	| { status: 'missing' }
	| { status: 'not-a-file' }
	| { message: string; status: 'failed' };

/**
 * Copies one files-to-copy candidate, creating parent directories as needed.
 * @param from - Absolute source path.
 * @param to - Absolute destination path.
 * @returns Whether the copy happened, and what stopped it when it did not.
 */
export function copyOneFile(from: string, to: string): CopyOneOutcome {
	if (!existsSync(from)) {
		return { status: 'missing' };
	}

	if (!lstatSync(from).isFile()) {
		return { status: 'not-a-file' };
	}

	try {
		mkdirSync(path.dirname(to), { recursive: true });
		copyFileSync(from, to);
		return { status: 'copied' };
	} catch (error) {
		return {
			message:
				error instanceof Error ? error.message : `Failed to copy ${from}.`,
			status: 'failed',
		};
	}
}

/**
 * Selects the highest-precedence source that declared a `filesToCopy` value:
 * `.worktreeinclude`, then `.ensemblr/settings.toml`, then the personal SQLite
 * override, then the built-in default. Mirrors the settings resolver's
 * precedence so committed config still wins over a personal override.
 * @param config - Loaded repository configuration.
 * @param personalPatterns - Personal (SQLite) patterns, when set.
 * @returns The chosen source plus its resolved pattern list.
 */
export function resolveFilesToCopyPatterns(
	config: LoadedRepositoryConfig,
	personalPatterns?: readonly string[],
): {
	patterns: string[];
	source: FilesToCopySource;
} {
	const candidates: ReadonlyArray<{
		patterns: string[] | null;
		source: FilesToCopySource;
	}> = [
		{
			patterns: readPatternList(config.worktreeincludeConfig?.filesToCopy),
			source: 'worktreeinclude',
		},
		{
			patterns: readPatternList(config.ensemblrConfig?.filesToCopy),
			source: 'ensemblr-config',
		},
		{ patterns: readPatternList(personalPatterns), source: 'personal' },
		{ patterns: [...DEFAULT_PATTERNS], source: 'default' },
	];

	// The built-in default always has patterns, so `find` always resolves.
	const selected =
		candidates.find((candidate) => candidate.patterns !== null) ??
		candidates[candidates.length - 1];

	return { patterns: selected.patterns ?? [], source: selected.source };
}

/**
 * Validates that `value` is an array of non-empty strings and returns a trimmed
 * clone; returns `null` when the value is missing or wrongly typed.
 * @param value - Candidate value from a config record.
 * @returns A clean pattern list or `null`.
 */
function readPatternList(value: unknown): string[] | null {
	if (!Array.isArray(value)) {
		return null;
	}

	const patterns: string[] = [];

	for (const entry of value) {
		if (typeof entry !== 'string') {
			return null;
		}

		const trimmed = entry.trim();
		if (trimmed.length > 0) {
			patterns.push(trimmed);
		}
	}

	return patterns;
}

/**
 * Builds the empty-snapshot shape used when no patterns produced candidates.
 * @param source - Resolved source identifier.
 * @param patterns - Resolved pattern list (may be empty).
 * @returns A {@link FilesToCopySnapshot} with no copies recorded.
 */
function emptySnapshot(
	source: FilesToCopySource,
	patterns: string[],
): FilesToCopySnapshot {
	return {
		copied: [],
		diagnostics: [],
		patterns,
		skipped: [],
		source,
	};
}

/**
 * Splits a NUL-separated git output stream into non-empty path entries.
 * @param value - Raw stdout from `git ls-files -z`.
 * @returns The list of paths.
 */
function parseNullSeparated(value: string): string[] {
	return value.split('\0').filter((entry) => entry.length > 0);
}

/**
 * Returns the first non-blank line of `text`; empty string when none exists.
 * @param text - Multi-line string to scan.
 * @returns The first non-blank line.
 */
function firstLine(text: string): string {
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed) {
			return trimmed;
		}
	}
	return '';
}
