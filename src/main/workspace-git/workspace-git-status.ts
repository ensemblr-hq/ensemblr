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
	WorkspaceGitDiffScope,
	WorkspaceGitFailureCode,
	WorkspaceGitFileWire,
} from '../../shared/ipc/contracts/workspace-git';
import type { LocalCommandService } from '../commands/local-command';
// react-doctor-disable-next-line -- Cross-concern imports use the stable public entrypoint.
import { resolveWorkspaceCwd } from '../workspace-files/index.ts';
import {
	parseNameStatus,
	parseNumstat,
	parsePorcelainStatus,
	parseWorkspaceCommits,
} from './workspace-git-parsers.ts';

const TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_DIFF_BYTES = 2 * 1024 * 1024;
const MAX_UNTRACKED_COUNT_BYTES = 512 * 1024;
const BINARY_SNIFF_BYTES = 8 * 1024;
const DEFAULT_COMMIT_LIMIT = 20;
const MAX_COMMIT_LIMIT = 100;
/** Git's well-known empty-tree object, used as a root commit's "parent". */
const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
/** Null device for `git diff --no-index` against an untracked file. */
const DEV_NULL = process.platform === 'win32' ? 'NUL' : '/dev/null';
const COMMIT_LOG_FORMAT = ['%H', '%h', '%an', '%aI', '%ar', '%s']
	.join('%x1f')
	.concat('%x1e');

/** Read-only git service exposing status, diff, commit log, and change-discard operations for a workspace. */
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

/**
 * Reads working-tree change state straight from git so the review surfaces
 * never cache stale file status. Status rows compare the working tree
 * (staged + unstaged + untracked) against HEAD.
 */
export function createWorkspaceGitService({
	localCommandService,
}: {
	localCommandService: LocalCommandService;
}): WorkspaceGitService {
	/**
	 * Runs a git subcommand in a workspace via the local command service.
	 * @param cwd - Absolute working directory to run git in
	 * @param args - Git arguments, excluding the `git` executable itself
	 * @param maxOutputBytes - Cap on captured stdout; defaults to the service limit
	 * @returns The command execution result
	 */
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
			// Scope to commits made on this workspace branch when a base is known, so
			// base-branch history — and the root/initial commit — stays out of the
			// list. An unresolvable base falls back to the full HEAD history.
			const range = request.baseRef
				? await resolveMergeBase(cwd.cwd, request.baseRef)
				: null;
			const result = await runGit(cwd.cwd, [
				'log',
				'-n',
				String(limit),
				'--no-color',
				`--pretty=format:${COMMIT_LOG_FORMAT}`,
				...(range ? [`${range}..HEAD`] : []),
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
			const scope: WorkspaceGitDiffScope = request.scope ?? {
				kind: 'working-tree',
			};
			if (scope.kind === 'commit') {
				return getCommitStatus(cwd.cwd, scope.commitHash);
			}
			if (scope.kind === 'branch') {
				return getBranchStatus(cwd.cwd, scope.baseRef);
			}
			return getWorkingTreeStatus(cwd.cwd);
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
			const scope: WorkspaceGitDiffScope = request.scope ?? {
				kind: 'working-tree',
			};
			if (scope.kind === 'commit') {
				return getCommitFileDiff(cwd.cwd, target.path, scope.commitHash);
			}
			if (scope.kind === 'branch') {
				return getBranchFileDiff(cwd.cwd, target.path, scope.baseRef);
			}
			return getWorkingTreeFileDiff(cwd.cwd, target.path);
		},
	};

	/** Working-tree change set: staged + unstaged + untracked, versus HEAD. */
	async function getWorkingTreeStatus(
		cwd: string,
	): Promise<GetWorkspaceGitStatusResult> {
		// `--untracked-files=all` is essential: git's default collapses an
		// untracked directory to a single `dir/` entry, so a brand-new folder
		// (e.g. an uncommitted `src/`) would show as one un-openable row and the
		// folder/list view toggle would have nothing to restructure. Expanding to
		// every individual file makes the change set match the working tree.
		const statusResult = await runGit(cwd, [
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
		const numstat = await readNumstatAgainstHead(cwd);

		const files: WorkspaceGitFileWire[] = await Promise.all(
			entries.map(async (entry) => {
				if (entry.status === 'untracked') {
					const counts = await countUntrackedLines(cwd, entry.path);
					return { ...entry, ...counts };
				}
				const counts = numstat.get(entry.path) ?? {
					additions: 0,
					deletions: 0,
				};
				return { ...entry, ...counts };
			}),
		);

		return summarizeFiles(files);
	}

	/** The changes a single commit introduced (`<parent>..<hash>`). */
	async function getCommitStatus(
		cwd: string,
		hash: string,
	): Promise<GetWorkspaceGitStatusResult> {
		const parent = await resolveCommitParent(cwd, hash);
		return buildDiffStatus(cwd, [parent, hash], false);
	}

	/**
	 * Every change on this branch: from the fork point (`merge-base`) to the
	 * working tree, so committed-on-branch edits and uncommitted edits both
	 * appear. Falls back to the working-tree set when no merge-base resolves
	 * (e.g. the base ref is unknown or unrelated).
	 */
	async function getBranchStatus(
		cwd: string,
		baseRef: string,
	): Promise<GetWorkspaceGitStatusResult> {
		const mergeBase = await resolveMergeBase(cwd, baseRef);
		if (!mergeBase) {
			return getWorkingTreeStatus(cwd);
		}
		return buildDiffStatus(cwd, [mergeBase], true);
	}

	/**
	 * Builds file rows from a `git diff` against `diffArgs` (a single ref to
	 * compare with the working tree, or `parent hash` for a commit range). When
	 * `includeUntracked` is set, working-tree untracked files are appended — a
	 * plain `git diff` never lists them.
	 */
	async function buildDiffStatus(
		cwd: string,
		diffArgs: readonly string[],
		includeUntracked: boolean,
	): Promise<GetWorkspaceGitStatusResult> {
		const [nameStatusResult, numstatResult] = await Promise.all([
			runGit(cwd, ['diff', '--no-color', '--name-status', '-z', ...diffArgs]),
			runGit(cwd, ['diff', '--no-color', '--numstat', '-z', ...diffArgs]),
		]);
		if (nameStatusResult.status !== 'success') {
			return emptyStatusResult(
				classifyGitFailure(nameStatusResult.stderr),
				nameStatusResult.failure?.message ??
					(nameStatusResult.stderr.trim() || 'git diff failed in workspace.'),
			);
		}

		const entries = parseNameStatus(nameStatusResult.stdout);
		const numstat =
			numstatResult.status === 'success'
				? parseNumstat(numstatResult.stdout)
				: new Map<
						string,
						{ additions: number | null; deletions: number | null }
					>();
		const files: WorkspaceGitFileWire[] = entries.map((entry) => {
			const counts = numstat.get(entry.path) ?? { additions: 0, deletions: 0 };
			return { ...entry, ...counts };
		});

		if (includeUntracked) {
			files.push(...(await readUntrackedFiles(cwd)));
		}

		return summarizeFiles(files);
	}

	/** Working-tree untracked files with line counts, for the branch view. */
	async function readUntrackedFiles(
		cwd: string,
	): Promise<WorkspaceGitFileWire[]> {
		const statusResult = await runGit(cwd, [
			'status',
			'--porcelain',
			'-z',
			'--untracked-files=all',
		]);
		if (statusResult.status !== 'success') {
			return [];
		}
		const untracked = parsePorcelainStatus(statusResult.stdout).filter(
			(entry) => entry.status === 'untracked',
		);
		return Promise.all(
			untracked.map(async (entry) => {
				const counts = await countUntrackedLines(cwd, entry.path);
				return { ...entry, ...counts };
			}),
		);
	}

	/** One file's unified diff against HEAD, with an untracked fallback. */
	async function getWorkingTreeFileDiff(
		cwd: string,
		relPath: string,
	): Promise<GetWorkspaceFileDiffResult> {
		const tracked = await runGit(
			cwd,
			['diff', '--no-color', 'HEAD', '--', relPath],
			MAX_DIFF_BYTES,
		);
		if (tracked.status === 'success' && tracked.stdout.trim()) {
			return {
				isTruncated: tracked.stdoutTruncated,
				patch: tracked.stdout,
				path: relPath,
			};
		}

		// Untracked files (and repos without a HEAD commit) fall through to a
		// no-index diff against /dev/null; git exits 1 when differences exist.
		const untracked = await untrackedFileDiff(cwd, relPath);
		if (untracked) {
			return untracked;
		}

		if (tracked.status === 'success') {
			return { patch: '', path: relPath };
		}
		return {
			error: {
				code: classifyGitFailure(tracked.stderr),
				message:
					tracked.failure?.message ??
					(tracked.stderr.trim() || 'git diff failed in workspace.'),
			},
			path: relPath,
		};
	}

	/** One file's diff for the changes a single commit introduced. */
	async function getCommitFileDiff(
		cwd: string,
		relPath: string,
		hash: string,
	): Promise<GetWorkspaceFileDiffResult> {
		const parent = await resolveCommitParent(cwd, hash);
		const result = await runGit(
			cwd,
			['diff', '--no-color', parent, hash, '--', relPath],
			MAX_DIFF_BYTES,
		);
		if (result.status === 'success') {
			return {
				isTruncated: result.stdoutTruncated,
				patch: result.stdout,
				path: relPath,
			};
		}
		return {
			error: {
				code: classifyGitFailure(result.stderr),
				message:
					result.failure?.message ??
					(result.stderr.trim() || 'git diff failed in workspace.'),
			},
			path: relPath,
		};
	}

	/** One file's diff across the whole branch (`merge-base`..working tree). */
	async function getBranchFileDiff(
		cwd: string,
		relPath: string,
		baseRef: string,
	): Promise<GetWorkspaceFileDiffResult> {
		const mergeBase = await resolveMergeBase(cwd, baseRef);
		if (!mergeBase) {
			return getWorkingTreeFileDiff(cwd, relPath);
		}
		const result = await runGit(
			cwd,
			['diff', '--no-color', mergeBase, '--', relPath],
			MAX_DIFF_BYTES,
		);
		if (result.status === 'success' && result.stdout.trim()) {
			return {
				isTruncated: result.stdoutTruncated,
				patch: result.stdout,
				path: relPath,
			};
		}
		// Untracked files are absent from the merge-base diff; show them too.
		const untracked = await untrackedFileDiff(cwd, relPath);
		if (untracked) {
			return untracked;
		}
		if (result.status === 'success') {
			return { patch: '', path: relPath };
		}
		return {
			error: {
				code: classifyGitFailure(result.stderr),
				message:
					result.failure?.message ??
					(result.stderr.trim() || 'git diff failed in workspace.'),
			},
			path: relPath,
		};
	}

	/** No-index diff of an untracked file against /dev/null, or `null` if empty. */
	async function untrackedFileDiff(
		cwd: string,
		relPath: string,
	): Promise<GetWorkspaceFileDiffResult | null> {
		const result = await runGit(
			cwd,
			['diff', '--no-color', '--no-index', '--', DEV_NULL, relPath],
			MAX_DIFF_BYTES,
		);
		if (result.stdout.trim()) {
			return {
				isTruncated: result.stdoutTruncated,
				patch: result.stdout,
				path: relPath,
			};
		}
		return null;
	}

	/** A commit's parent hash, or the empty tree for a root commit. */
	async function resolveCommitParent(
		cwd: string,
		hash: string,
	): Promise<string> {
		const result = await runGit(cwd, [
			'rev-parse',
			'--verify',
			'--quiet',
			`${hash}^`,
		]);
		if (result.status === 'success') {
			const parent = result.stdout.trim();
			if (parent) {
				return parent;
			}
		}
		return EMPTY_TREE_HASH;
	}

	/** The merge-base of `baseRef` and HEAD, or `null` when none resolves. */
	async function resolveMergeBase(
		cwd: string,
		baseRef: string,
	): Promise<string | null> {
		const result = await runGit(cwd, ['merge-base', baseRef, 'HEAD']);
		if (result.status === 'success') {
			return result.stdout.trim() || null;
		}
		return null;
	}

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

/** Totals additions/deletions across the rows into a status result. */
function summarizeFiles(
	files: WorkspaceGitFileWire[],
): GetWorkspaceGitStatusResult {
	let additions = 0;
	let deletions = 0;
	for (const file of files) {
		additions += file.additions ?? 0;
		deletions += file.deletions ?? 0;
	}
	return { files, summary: { additions, deletions, files: files.length } };
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
