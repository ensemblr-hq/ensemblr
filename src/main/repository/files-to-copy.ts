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
			const resolved = resolvePatterns(input.config);

			if (resolved.patterns.length === 0) {
				return emptySnapshot(resolved.source, resolved.patterns);
			}

			const tmpDirectory = mkdtempSync(
				path.join(tmpdir(), 'ensemblr-files-to-copy-'),
			);
			const patternsPath = path.join(tmpDirectory, 'patterns');

			try {
				writeFileSync(
					patternsPath,
					`${resolved.patterns.join('\n')}\n`,
					'utf8',
				);

				const result = await localCommandService.run({
					args: [
						'ls-files',
						'-z',
						'--others',
						'--ignored',
						`--exclude-from=${patternsPath}`,
					],
					command: 'git',
					cwd: input.repositoryPath,
					maxOutputBytes: LS_FILES_MAX_OUTPUT_BYTES,
					timeoutMs: LS_FILES_TIMEOUT_MS,
				});

				if (result.status !== 'success') {
					return {
						copied: [],
						diagnostics: [
							{
								code: 'pattern-listing-failed',
								message:
									firstLine(result.stderr) ||
									'git ls-files failed to enumerate files-to-copy candidates.',
								severity: 'warning',
							},
						],
						patterns: resolved.patterns,
						skipped: [],
						source: resolved.source,
					};
				}

				const relativePaths = parseNullSeparated(result.stdout);
				const copied: FilesToCopyEntry[] = [];
				const skipped: FilesToCopyDiagnostic[] = [];
				const diagnostics: FilesToCopyDiagnostic[] = [];

				for (const relativePath of relativePaths) {
					const from = path.join(input.repositoryPath, relativePath);
					const to = path.join(input.workspacePath, relativePath);

					if (!existsSync(from)) {
						skipped.push({
							code: 'source-path-missing',
							message: `Source path ${relativePath} no longer exists; skipped.`,
							path: relativePath,
							severity: 'info',
						});
						continue;
					}

					const stats = lstatSync(from);

					if (!stats.isFile()) {
						skipped.push({
							code: 'source-path-missing',
							message: `Source path ${relativePath} is not a regular file; skipped.`,
							path: relativePath,
							severity: 'info',
						});
						continue;
					}

					try {
						mkdirSync(path.dirname(to), { recursive: true });
						copyFileSync(from, to);
						copied.push({ from, relativePath, to });
					} catch (error) {
						diagnostics.push({
							code: 'copy-failed',
							message:
								error instanceof Error
									? error.message
									: `Failed to copy ${relativePath}.`,
							path: relativePath,
							severity: 'warning',
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
			} finally {
				try {
					rmSync(tmpDirectory, { force: true, recursive: true });
				} catch {
					// Best effort: temp scratch left behind on next OS cleanup.
				}
			}
		},
	};
}

/**
 * Selects the highest-precedence config source that declared a `filesToCopy`
 * value; falls back to the built-in default when none did.
 * @param config - Loaded repository configuration.
 * @returns The chosen source plus its resolved pattern list.
 */
function resolvePatterns(config: LoadedRepositoryConfig): {
	patterns: string[];
	source: FilesToCopySource;
} {
	const candidates: ReadonlyArray<{
		record: Record<string, unknown> | undefined;
		source: FilesToCopySource;
	}> = [
		{ record: config.worktreeincludeConfig, source: 'worktreeinclude' },
		{ record: config.ensemblrConfig, source: 'ensemblr-config' },
	];

	for (const candidate of candidates) {
		const patterns = readPatternList(candidate.record?.filesToCopy);
		if (patterns) {
			return { patterns, source: candidate.source };
		}
	}

	return { patterns: [...DEFAULT_PATTERNS], source: 'default' };
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
