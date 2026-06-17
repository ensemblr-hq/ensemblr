import { open, rm } from 'node:fs/promises';
import path from 'node:path';

import type {
	DiscardWorkspaceChangesRequest,
	DiscardWorkspaceChangesResult,
	GetWorkspaceCommitsRequest,
	GetWorkspaceCommitsResult,
	GetWorkspaceFileDiffRequest,
	GetWorkspaceFileDiffResult,
	GetWorkspaceGitStatusRequest,
	GetWorkspaceGitStatusResult,
	WorkspaceCommitWire,
	WorkspaceGitFailureCode,
	WorkspaceGitFileStatus,
	WorkspaceGitFileWire,
} from '../../shared/ipc/contracts/workspace-git';
import type { LocalCommandService } from '../commands/local-command';

const TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_DIFF_BYTES = 2 * 1024 * 1024;
const MAX_UNTRACKED_COUNT_BYTES = 512 * 1024;
const BINARY_SNIFF_BYTES = 8 * 1024;
const DEFAULT_COMMIT_LIMIT = 20;
const MAX_COMMIT_LIMIT = 100;
/** Unit/record separators keep commit subjects (which may hold anything) safe. */
const COMMIT_FIELD_SEP = '\x1f';
const COMMIT_RECORD_SEP = '\x1e';
const COMMIT_LOG_FORMAT = ['%H', '%h', '%an', '%aI', '%ar', '%s']
	.join('%x1f')
	.concat('%x1e');

export interface WorkspaceGitService {
	discardChanges: (
		request: DiscardWorkspaceChangesRequest,
	) => Promise<DiscardWorkspaceChangesResult>;
	getCommits: (
		request: GetWorkspaceCommitsRequest,
	) => Promise<GetWorkspaceCommitsResult>;
	getFileDiff: (
		request: GetWorkspaceFileDiffRequest,
	) => Promise<GetWorkspaceFileDiffResult>;
	getStatus: (
		request: GetWorkspaceGitStatusRequest,
	) => Promise<GetWorkspaceGitStatusResult>;
}

export interface CreateWorkspaceGitServiceOptions {
	localCommandService: LocalCommandService;
}

/**
 * Reads working-tree change state straight from git so the review surfaces
 * never cache stale file status. Status rows compare the working tree
 * (staged + unstaged + untracked) against HEAD.
 */
export function createWorkspaceGitService({
	localCommandService,
}: CreateWorkspaceGitServiceOptions): WorkspaceGitService {
	async function runGit(
		cwd: string,
		args: readonly string[],
		maxOutputBytes = MAX_OUTPUT_BYTES,
	) {
		return localCommandService.run({
			args: [...args],
			command: 'git',
			cwd,
			maxOutputBytes,
			timeoutMs: TIMEOUT_MS,
		});
	}

	return {
		async getCommits(request) {
			const cwd = resolveWorkspaceCwd(request.workspaceCwd);
			if (!cwd.ok) {
				return {
					commits: [],
					error: { code: 'invalid-cwd', message: cwd.message },
				};
			}
			const limit = clampCommitLimit(request.limit);
			const result = await runGit(cwd.cwd, [
				'log',
				'-n',
				String(limit),
				'--no-color',
				`--pretty=format:${COMMIT_LOG_FORMAT}`,
			]);
			if (result.status !== 'success') {
				// An unborn branch (no commits yet) is an empty list, not an error.
				if (isNoCommitsYet(result.stderr)) {
					return { commits: [] };
				}
				return {
					commits: [],
					error: {
						code: classifyGitFailure(result.stderr),
						message:
							result.failure?.message ??
							(result.stderr.trim() || 'git log failed in workspace.'),
					},
				};
			}
			return { commits: parseWorkspaceCommits(result.stdout) };
		},

		async getStatus(request) {
			const cwd = resolveWorkspaceCwd(request.workspaceCwd);
			if (!cwd.ok) {
				return emptyStatusResult('invalid-cwd', cwd.message);
			}

			// `--untracked-files=all` is essential: git's default collapses an
			// untracked directory to a single `dir/` entry, so a brand-new folder
			// (e.g. an uncommitted `src/`) would show as one un-openable row and the
			// folder/list view toggle would have nothing to restructure. Expanding to
			// every individual file makes the change set match the working tree.
			const statusResult = await runGit(cwd.cwd, [
				'status',
				'--porcelain',
				'-z',
				'--untracked-files=all',
			]);
			if (statusResult.status !== 'success') {
				return emptyStatusResult(
					classifyGitFailure(statusResult.stderr),
					statusResult.failure?.message ??
						(statusResult.stderr.trim() || 'git status failed in workspace.'),
				);
			}

			const entries = parsePorcelainStatus(statusResult.stdout);
			const numstat = await readNumstatAgainstHead(cwd.cwd);

			const files: WorkspaceGitFileWire[] = await Promise.all(
				entries.map(async (entry) => {
					if (entry.status === 'untracked') {
						const counts = await countUntrackedLines(cwd.cwd, entry.path);
						return { ...entry, ...counts };
					}
					const counts = numstat.get(entry.path) ?? {
						additions: 0,
						deletions: 0,
					};
					return { ...entry, ...counts };
				}),
			);

			let additions = 0;
			let deletions = 0;
			for (const file of files) {
				additions += file.additions ?? 0;
				deletions += file.deletions ?? 0;
			}

			return {
				files,
				summary: { additions, deletions, files: files.length },
			};
		},

		async discardChanges(request) {
			const cwd = resolveWorkspaceCwd(request.workspaceCwd);
			if (!cwd.ok) {
				return {
					discarded: [],
					error: { code: 'invalid-cwd', message: cwd.message },
				};
			}

			// De-dupe up front so a rename's new+old paths (or a repeated request)
			// each run once, and reject any escaping path before touching the repo.
			const seen = new Set<string>();
			const targets: string[] = [];
			for (const raw of request.paths) {
				const target = validateRelativePath(raw);
				if (!target.ok) {
					return {
						discarded: [],
						error: { code: 'invalid-path', message: target.message },
					};
				}
				if (!seen.has(target.path)) {
					seen.add(target.path);
					targets.push(target.path);
				}
			}

			const discarded: string[] = [];
			let failure: DiscardWorkspaceChangesResult['error'];
			for (const relPath of targets) {
				const outcome = await discardSinglePath(cwd.cwd, relPath);
				if (outcome.ok) {
					discarded.push(relPath);
				} else {
					// Keep going so one bad path can't strand the rest; surface the
					// first failure once the batch finishes.
					failure ??= outcome.error;
				}
			}

			return failure ? { discarded, error: failure } : { discarded };
		},

		async getFileDiff(request) {
			const cwd = resolveWorkspaceCwd(request.workspaceCwd);
			if (!cwd.ok) {
				return {
					error: { code: 'invalid-cwd', message: cwd.message },
					path: request.path,
				};
			}
			const target = validateRelativePath(request.path);
			if (!target.ok) {
				return {
					error: { code: 'invalid-path', message: target.message },
					path: request.path,
				};
			}

			const tracked = await runGit(
				cwd.cwd,
				['diff', '--no-color', 'HEAD', '--', target.path],
				MAX_DIFF_BYTES,
			);
			if (tracked.status === 'success' && tracked.stdout.trim()) {
				return {
					isTruncated: tracked.stdoutTruncated,
					patch: tracked.stdout,
					path: target.path,
				};
			}

			// Untracked files (and repos without a HEAD commit) fall through to a
			// no-index diff against /dev/null; git exits 1 when differences exist.
			const untracked = await runGit(
				cwd.cwd,
				[
					'diff',
					'--no-color',
					'--no-index',
					'--',
					process.platform === 'win32' ? 'NUL' : '/dev/null',
					target.path,
				],
				MAX_DIFF_BYTES,
			);
			if (untracked.stdout.trim()) {
				return {
					isTruncated: untracked.stdoutTruncated,
					patch: untracked.stdout,
					path: target.path,
				};
			}

			if (tracked.status === 'success') {
				return { patch: '', path: target.path };
			}
			return {
				error: {
					code: classifyGitFailure(tracked.stderr),
					message:
						tracked.failure?.message ??
						(tracked.stderr.trim() || 'git diff failed in workspace.'),
				},
				path: target.path,
			};
		},
	};

	/** Maps changed paths to +/- counts versus HEAD, tolerating unborn branches. */
	async function readNumstatAgainstHead(
		cwd: string,
	): Promise<
		Map<string, { additions: number | null; deletions: number | null }>
	> {
		const headResult = await runGit(cwd, ['diff', '--numstat', '-z', 'HEAD']);
		if (headResult.status === 'success') {
			return parseNumstat(headResult.stdout);
		}
		// Unborn branch (no commits yet): merge staged + unstaged numstat instead.
		const counts = new Map<
			string,
			{ additions: number | null; deletions: number | null }
		>();
		const results = await Promise.all(
			[
				['diff', '--numstat', '-z', '--cached'],
				['diff', '--numstat', '-z'],
			].map((args) => runGit(cwd, args)),
		);
		for (const result of results) {
			if (result.status !== 'success') {
				continue;
			}
			for (const [filePath, value] of parseNumstat(result.stdout)) {
				const existing = counts.get(filePath);
				counts.set(
					filePath,
					existing
						? {
								additions: addNullable(existing.additions, value.additions),
								deletions: addNullable(existing.deletions, value.deletions),
							}
						: value,
				);
			}
		}
		return counts;
	}

	/** Counts lines in an untracked file so new files still show +N in review. */
	async function countUntrackedLines(
		cwd: string,
		relativePath: string,
	): Promise<{ additions: number | null; deletions: number | null }> {
		try {
			const handle = await open(path.join(cwd, relativePath), 'r');
			try {
				const stat = await handle.stat();
				if (!stat.isFile()) {
					return { additions: 0, deletions: 0 };
				}
				const readBytes = Math.min(stat.size, MAX_UNTRACKED_COUNT_BYTES);
				if (readBytes === 0) {
					return { additions: 0, deletions: 0 };
				}
				const buffer = Buffer.alloc(readBytes);
				await handle.read(buffer, 0, readBytes, 0);
				if (
					buffer
						.subarray(0, Math.min(readBytes, BINARY_SNIFF_BYTES))
						.includes(0)
				) {
					return { additions: null, deletions: null };
				}
				let lines = 0;
				for (const byte of buffer) {
					if (byte === 0x0a) {
						lines += 1;
					}
				}
				if (buffer[readBytes - 1] !== 0x0a) {
					lines += 1;
				}
				return { additions: lines, deletions: 0 };
			} finally {
				await handle.close();
			}
		} catch {
			return { additions: 0, deletions: 0 };
		}
	}

	/**
	 * Reverts one working-tree path. A path present in HEAD is restored to its
	 * committed content (covers modified, staged-modified, and deleted files); a
	 * path absent from HEAD (newly added or untracked) is unstaged and its
	 * working-tree copy is removed. Both git calls are scoped to the single
	 * pathspec, so nothing outside the requested file is touched.
	 */
	async function discardSinglePath(
		cwd: string,
		relPath: string,
	): Promise<
		| { ok: true }
		| { error: NonNullable<DiscardWorkspaceChangesResult['error']>; ok: false }
	> {
		const inHead = await runGit(cwd, ['cat-file', '-e', `HEAD:${relPath}`]);
		if (inHead.status === 'success') {
			const restore = await runGit(cwd, ['checkout', 'HEAD', '--', relPath]);
			if (restore.status === 'success') {
				return { ok: true };
			}
			return {
				error: {
					code: classifyGitFailure(restore.stderr),
					message:
						restore.failure?.message ??
						(restore.stderr.trim() || `Could not restore ${relPath}.`),
				},
				ok: false,
			};
		}

		// Absent from HEAD: drop it from the index if it was staged
		// (`--ignore-unmatch` tolerates plain untracked files), then delete the
		// working-tree copy so the new file is gone entirely.
		const unstage = await runGit(cwd, [
			'rm',
			'--cached',
			'--force',
			'--ignore-unmatch',
			'--',
			relPath,
		]);
		if (unstage.status !== 'success') {
			return {
				error: {
					code: classifyGitFailure(unstage.stderr),
					message:
						unstage.failure?.message ??
						(unstage.stderr.trim() || `Could not unstage ${relPath}.`),
				},
				ok: false,
			};
		}

		try {
			await rm(path.join(cwd, relPath), { force: true });
		} catch (error) {
			return {
				error: {
					code: 'command-failed',
					message:
						error instanceof Error
							? error.message
							: `Could not delete ${relPath}.`,
				},
				ok: false,
			};
		}
		return { ok: true };
	}
}

/** Adds two nullable line counts, propagating binary (`null`) markers. */
function addNullable(a: number | null, b: number | null): number | null {
	if (a === null || b === null) {
		return null;
	}
	return a + b;
}

/** Clamps the requested commit page size into the supported range. */
function clampCommitLimit(limit: number | undefined): number {
	if (typeof limit !== 'number' || !Number.isFinite(limit)) {
		return DEFAULT_COMMIT_LIMIT;
	}
	return Math.max(1, Math.min(MAX_COMMIT_LIMIT, Math.trunc(limit)));
}

/** True when git reports the branch has no commits yet (unborn HEAD). */
function isNoCommitsYet(stderr: string): boolean {
	return stderr.toLowerCase().includes('does not have any commits yet');
}

/**
 * Parses the unit/record-separated `git log` output into commit rows. Each
 * record is `hash␟short␟author␟isoDate␟relative␟subject␞`; the trailing record
 * separator yields one empty chunk that is skipped.
 */
export function parseWorkspaceCommits(stdout: string): WorkspaceCommitWire[] {
	const commits: WorkspaceCommitWire[] = [];
	for (const record of stdout.split(COMMIT_RECORD_SEP)) {
		// Records are newline-joined by `--pretty=format`; drop the leading break.
		const trimmed = record.replace(/^\s+/, '');
		if (!trimmed) {
			continue;
		}
		const fields = trimmed.split(COMMIT_FIELD_SEP);
		const [hash, shortHash, author, isoDate, relativeTime, subject] = fields;
		if (fields.length < 6 || !hash) {
			continue;
		}
		commits.push({
			author: author ?? '',
			hash,
			isoDate: isoDate ?? '',
			relativeTime: relativeTime ?? '',
			shortHash: shortHash ?? '',
			subject: subject ?? '',
		});
	}
	return commits;
}

/** Builds the failed-status result shape with empty rows. */
function emptyStatusResult(
	code: WorkspaceGitFailureCode,
	message: string,
): GetWorkspaceGitStatusResult {
	return {
		error: { code, message },
		files: [],
		summary: { additions: 0, deletions: 0, files: 0 },
	};
}

/** Distinguishes "not a repo" from generic git failures via stderr. */
function classifyGitFailure(
	stderr: string,
): 'command-failed' | 'not-a-git-repo' {
	const lowered = stderr.toLowerCase();
	if (
		lowered.includes('not a git repository') ||
		lowered.includes('does not have any git working tree')
	) {
		return 'not-a-git-repo';
	}
	return 'command-failed';
}

interface PorcelainEntry {
	path: string;
	renamedFrom?: string;
	status: WorkspaceGitFileStatus;
}

/**
 * Parses `git status --porcelain -z` output. Rename entries emit a second
 * NUL-separated token holding the original path.
 */
export function parsePorcelainStatus(
	stdout: string,
): readonly PorcelainEntry[] {
	const tokens = stdout.split('\0');
	const entries: PorcelainEntry[] = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token || token.length < 4) {
			continue;
		}
		const stagedCode = token[0];
		const unstagedCode = token[1];
		const filePath = token.slice(3);
		const status = classifyPorcelainCodes(stagedCode, unstagedCode);
		if (status === 'renamed') {
			const renamedFrom = tokens[index + 1];
			index += 1;
			entries.push({
				path: filePath,
				...(renamedFrom ? { renamedFrom } : {}),
				status,
			});
			continue;
		}
		entries.push({ path: filePath, status });
	}
	return entries;
}

/** Maps porcelain XY codes to a renderer-facing file status. */
function classifyPorcelainCodes(
	staged: string,
	unstaged: string,
): WorkspaceGitFileStatus {
	if (staged === '?' || unstaged === '?') {
		return 'untracked';
	}
	if (staged === '!' || unstaged === '!') {
		return 'ignored';
	}
	if (
		staged === 'U' ||
		unstaged === 'U' ||
		(staged === 'A' && unstaged === 'A') ||
		(staged === 'D' && unstaged === 'D')
	) {
		return 'conflicted';
	}
	if (staged === 'R' || unstaged === 'R') {
		return 'renamed';
	}
	if (staged === 'A') {
		return 'added';
	}
	if (staged === 'D' || unstaged === 'D') {
		return 'deleted';
	}
	return 'modified';
}

/**
 * Parses `git diff --numstat -z` output into path → counts. Binary files use
 * `-` for both counts and map to `null`. Renames emit
 * `added\tdeleted\t\0old\0new\0`.
 */
export function parseNumstat(
	stdout: string,
): Map<string, { additions: number | null; deletions: number | null }> {
	const counts = new Map<
		string,
		{ additions: number | null; deletions: number | null }
	>();
	const tokens = stdout.split('\0');
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token) {
			continue;
		}
		const parts = token.split('\t');
		if (parts.length < 3) {
			continue;
		}
		const additions = parts[0] === '-' ? null : Number.parseInt(parts[0], 10);
		const deletions = parts[1] === '-' ? null : Number.parseInt(parts[1], 10);
		let filePath = parts[2];
		if (!filePath) {
			// Rename form: counts token ends with an empty path, followed by
			// old-path and new-path tokens.
			index += 2;
			filePath = tokens[index] ?? '';
		}
		if (!filePath) {
			continue;
		}
		counts.set(filePath, {
			additions: Number.isNaN(additions) ? null : additions,
			deletions: Number.isNaN(deletions) ? null : deletions,
		});
	}
	return counts;
}

/** Validates and normalizes an absolute workspace cwd from the renderer. */
function resolveWorkspaceCwd(
	workspaceCwd: string,
): { cwd: string; ok: true } | { message: string; ok: false } {
	const cwd = workspaceCwd?.trim();
	if (!cwd || !path.isAbsolute(cwd)) {
		return {
			message: 'Workspace path must be an absolute filesystem path.',
			ok: false,
		};
	}
	return { cwd, ok: true };
}

/** Rejects absolute or workspace-escaping relative paths from the renderer. */
function validateRelativePath(
	pathValue: string,
): { ok: true; path: string } | { message: string; ok: false } {
	const raw = pathValue.trim();
	if (!raw || path.isAbsolute(raw)) {
		return { message: 'Workspace file path must be relative.', ok: false };
	}
	const normalized = path.normalize(raw);
	if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
		return {
			message: 'Workspace file path must stay inside the workspace.',
			ok: false,
		};
	}
	return { ok: true, path: normalized.split(path.sep).join('/') };
}
