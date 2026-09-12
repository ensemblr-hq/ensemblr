import { open, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { bareBranchName, originQualifiedRef } from '../../shared/branch-ref.ts';
import type {
	DiscardWorkspaceChangesRequest,
	DiscardWorkspaceChangesResult,
	GetWorkspaceCommitsRequest,
	GetWorkspaceCommitsResult,
	GetWorkspaceFileDiffRequest,
	GetWorkspaceFileDiffResult,
	GetWorkspaceGitStatusRequest,
	GetWorkspaceGitStatusResult,
	GetWorkspaceMergeConflictsRequest,
	GetWorkspaceMergeConflictsResult,
	WorkspaceGitDiffScope,
	WorkspaceGitFailure,
	WorkspaceGitFileWire,
} from '../../shared/ipc/contracts/workspace-git.ts';
import { summarizeWorkspaceGitFiles } from '../../shared/ipc/contracts/workspace-git.ts';
import type { LocalCommandService } from '../commands/local-command';
// react-doctor-disable-next-line -- Cross-concern imports use the stable public entrypoint.
import { mapWithConcurrency } from '../concurrency/index.ts';
// react-doctor-disable-next-line -- Cross-concern imports use the stable public entrypoint.
import { resolveWorkspaceCwd } from '../workspace-files/index.ts';
import {
	classifyGitFailure,
	gitFailure,
	gitFailureMessage,
} from './workspace-git-failures.ts';
import { readMergeConflicts } from './workspace-git-merge-conflicts.ts';
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
/**
 * Most `git` invocations this service keeps in flight at once.
 *
 * The dashboard asks for one branch-scope status per workspace on one tick, and
 * each of those is ~4 spawns plus a read per untracked file. At 15 workspaces
 * that measured 60 concurrent `git` processes and 666 ms of churn every 30 s,
 * all on the thread that answers IPC. The work still gets done; it stops
 * arriving as one burst.
 */
const MAX_CONCURRENT_GIT = 4;
/**
 * Most untracked files whose lines are actually counted.
 *
 * Counting opens a descriptor and allocates up to
 * {@link MAX_UNTRACKED_COUNT_BYTES} per file, so a working tree with an
 * unpacked tarball or a build output in it would hold hundreds of megabytes
 * live at once. Past this many rows a `null` count is the honest answer — the
 * reviewer is looking at the file list, not at per-file line totals.
 */
export const MAX_COUNTED_UNTRACKED_FILES = 200;
/** Most untracked files read concurrently, bounding open descriptors. */
const MAX_CONCURRENT_UNTRACKED_READS = 16;
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

/**
 * The stored merge-target ref and its other common shape. Resolution later
 * adds the local branch's configured upstream and selects the nearest merge
 * base each candidate shares with HEAD, preserving where this workspace forked
 * even after the target refs move again.
 * @param baseRef - The base ref as persisted on the workspace.
 * @returns Candidate refs, deduplicated and in priority order.
 */
function mergeBaseCandidates(baseRef: string): string[] {
	const alternate =
		baseRef === bareBranchName(baseRef)
			? originQualifiedRef(baseRef)
			: bareBranchName(baseRef);
	return [...new Set([baseRef, alternate ?? ''].filter(Boolean))];
}

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
	getMergeConflicts: (
		request: GetWorkspaceMergeConflictsRequest,
	) => Promise<GetWorkspaceMergeConflictsResult>;
	/**
	 * Working-tree paths only, with none of the line counts, content stamps, or
	 * summaries {@link WorkspaceGitService.getStatus} builds. It backs decisions
	 * about *which* files moved rather than a view of them, so it stays cheap
	 * enough to run on every agent turn. Best-effort: an unreadable workspace
	 * reports an empty change set rather than failing its caller.
	 */
	listChangedPaths: (workspaceCwd: string) => Promise<readonly string[]>;
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
	 * Statuses currently being computed, keyed by workspace and scope. Concurrent
	 * identical requests — the dashboard tick and an open Changes view, or two
	 * windows — share one answer instead of racing two identical fan-outs. The
	 * entry is dropped the moment the flight settles, so nothing is ever served
	 * from a stale read.
	 */
	const statusesInFlight = new Map<
		string,
		Promise<GetWorkspaceGitStatusResult>
	>();
	let gitSlotsFree = MAX_CONCURRENT_GIT;
	const gitSlotWaiters: Array<() => void> = [];

	/** Releases one git slot, handing it straight to the longest waiter. */
	function releaseGitSlot(): void {
		const waiter = gitSlotWaiters.shift();
		if (waiter) {
			waiter();
			return;
		}
		gitSlotsFree += 1;
	}

	/** Waits for a free git slot, resolving immediately when one is available. */
	function acquireGitSlot(): Promise<void> {
		if (gitSlotsFree > 0) {
			gitSlotsFree -= 1;
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			gitSlotWaiters.push(resolve);
		});
	}

	/**
	 * Runs a git subcommand in a workspace via the local command service, behind
	 * a {@link MAX_CONCURRENT_GIT} semaphore so a multi-workspace refresh queues
	 * rather than spawning every process at once.
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
		await acquireGitSlot();
		try {
			return await localCommandService.run({
				args: [...args],
				command: 'git',
				cwd,
				maxOutputBytes,
				timeoutMs: TIMEOUT_MS,
			});
		} finally {
			releaseGitSlot();
		}
	}

	/**
	 * Runs `compute` unless an identical request is already in flight, in which
	 * case both callers await the same promise.
	 * @param key - Identity of the request: workspace plus scope.
	 * @param compute - Produces the status when no flight is under way.
	 * @returns The shared result.
	 */
	function shareStatusInFlight(
		key: string,
		compute: () => Promise<GetWorkspaceGitStatusResult>,
	): Promise<GetWorkspaceGitStatusResult> {
		const existing = statusesInFlight.get(key);
		if (existing) {
			return existing;
		}

		const flight = compute().finally(() => {
			statusesInFlight.delete(key);
		});
		statusesInFlight.set(key, flight);
		return flight;
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
						message: gitFailureMessage(result, 'git log failed in workspace.'),
					},
				};
			}
			return { commits: parseWorkspaceCommits(result.stdout) };
		},

		async getStatus(request) {
			const cwd = resolveWorkspaceCwd(request.workspaceCwd);
			if (!cwd.ok) {
				return emptyStatusResult({
					code: 'invalid-cwd',
					message: cwd.message,
				});
			}
			const scope: WorkspaceGitDiffScope = request.scope ?? {
				kind: 'working-tree',
			};
			if (scope.kind === 'commit') {
				return shareStatusInFlight(
					`${cwd.cwd}\u0000commit\u0000${scope.commitHash}`,
					() => getCommitStatus(cwd.cwd, scope.commitHash),
				);
			}
			if (scope.kind === 'branch') {
				return shareStatusInFlight(
					`${cwd.cwd}\u0000branch\u0000${scope.baseRef}`,
					() => getBranchStatus(cwd.cwd, scope.baseRef),
				);
			}
			return shareStatusInFlight(`${cwd.cwd}\u0000working-tree`, () =>
				getWorkingTreeStatus(cwd.cwd),
			);
		},

		async getMergeConflicts(request) {
			const cwd = resolveWorkspaceCwd(request.workspaceCwd);
			if (!cwd.ok) {
				return {
					error: { code: 'invalid-cwd', message: cwd.message },
					paths: [],
				};
			}
			return readMergeConflicts(runGit, cwd.cwd, request.baseRef);
		},

		async listChangedPaths(workspaceCwd) {
			const cwd = resolveWorkspaceCwd(workspaceCwd);
			if (!cwd.ok) {
				return [];
			}
			const result = await runGit(cwd.cwd, [
				'status',
				'--porcelain',
				'-z',
				'--untracked-files=all',
			]);
			if (result.status !== 'success') {
				return [];
			}
			return parsePorcelainStatus(result.stdout).map((entry) => entry.path);
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
				gitFailure(statusResult, 'git status failed in workspace.'),
			);
		}

		const entries = parsePorcelainStatus(statusResult.stdout);
		const numstat = await readNumstatAgainstHead(cwd);

		const countable = countableUntrackedPaths(entries);
		const files: WorkspaceGitFileWire[] = await mapWithConcurrency(
			entries,
			MAX_CONCURRENT_UNTRACKED_READS,
			async (entry) => {
				if (entry.status === 'untracked') {
					return {
						...entry,
						...(await untrackedCounts(cwd, entry.path, countable)),
					};
				}
				const counts = numstat.get(entry.path) ?? {
					additions: 0,
					deletions: 0,
				};
				return { ...entry, ...counts };
			},
		);

		return summarizeWorkspaceGitFiles(await withContentIds(cwd, files));
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
	 * compare with the working tree, or `parent hash` for a commit range).
	 *
	 * `newSideIsWorkingTree` says which of the two the rows describe. When set,
	 * untracked files are appended — a plain `git diff` never lists them — and
	 * every row carries a content stamp, since the bytes it describes can still
	 * change. A commit range needs neither: its content is already frozen.
	 */
	async function buildDiffStatus(
		cwd: string,
		diffArgs: readonly string[],
		newSideIsWorkingTree: boolean,
	): Promise<GetWorkspaceGitStatusResult> {
		const [nameStatusResult, numstatResult] = await Promise.all([
			runGit(cwd, ['diff', '--no-color', '--name-status', '-z', ...diffArgs]),
			runGit(cwd, ['diff', '--no-color', '--numstat', '-z', ...diffArgs]),
		]);
		if (nameStatusResult.status !== 'success') {
			return emptyStatusResult(
				gitFailure(nameStatusResult, 'git diff failed in workspace.'),
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

		if (!newSideIsWorkingTree) {
			return summarizeWorkspaceGitFiles(files);
		}
		files.push(...(await readUntrackedFiles(cwd)));
		return summarizeWorkspaceGitFiles(await withContentIds(cwd, files));
	}

	/**
	 * Stamps each row with the current bytes of its working-tree file, so a
	 * reviewer's "viewed" mark stops matching the moment the file is written
	 * again — including for a binary file, whose line counts are always `null`,
	 * and for an edit that happens to leave the counts unchanged.
	 * @param cwd - Absolute workspace directory the paths are relative to
	 * @param files - Rows whose new side is the working tree
	 * @returns The same rows, each carrying a content stamp
	 */
	async function withContentIds(
		cwd: string,
		files: readonly WorkspaceGitFileWire[],
	): Promise<WorkspaceGitFileWire[]> {
		return mapWithConcurrency(
			files,
			MAX_CONCURRENT_UNTRACKED_READS,
			async (file) => ({
				...file,
				contentId: await readContentId(cwd, file.path),
			}),
		);
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
		const countable = countableUntrackedPaths(untracked);
		return mapWithConcurrency(
			untracked,
			MAX_CONCURRENT_UNTRACKED_READS,
			async (entry) => ({
				...entry,
				...(await untrackedCounts(cwd, entry.path, countable)),
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
				message: gitFailureMessage(tracked, 'git diff failed in workspace.'),
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
				message: gitFailureMessage(result, 'git diff failed in workspace.'),
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
				message: gitFailureMessage(result, 'git diff failed in workspace.'),
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

	/**
	 * The merge-base of `baseRef` and HEAD, or `null` when none resolves.
	 *
	 * Base refs reach SQLite in bare and remote-qualified shapes. The resolver
	 * also considers a bare local branch's configured upstream, computes each
	 * candidate's merge-base with HEAD, then selects the nearest of those merge
	 * bases. A remote advancing again therefore retains the original fork point,
	 * while a locally-ahead fork still compares against its local commits.
	 * @param cwd - Workspace worktree to resolve in.
	 * @param baseRef - The base ref as persisted on the workspace.
	 * @returns The merge-base commit, or null when none resolves.
	 */
	async function resolveMergeBase(
		cwd: string,
		baseRef: string,
	): Promise<string | null> {
		const candidates = await refShapesToTry(cwd, baseRef);
		const mergeBases = await mergeBasesWithHead(cwd, candidates);

		return mergeBases.length > 1
			? nearestToHead(cwd, mergeBases)
			: (mergeBases[0] ?? null);
	}

	/**
	 * The distinct refs worth trying as a merge target: the stored ref, its other
	 * common shape, and the local branch's configured upstream when it has one.
	 * @param cwd - Workspace worktree to resolve in.
	 * @param baseRef - The base ref as persisted on the workspace.
	 * @returns Deduplicated candidate refs.
	 */
	async function refShapesToTry(
		cwd: string,
		baseRef: string,
	): Promise<string[]> {
		const candidates = mergeBaseCandidates(baseRef);
		const upstream = await runGit(cwd, [
			'rev-parse',
			'--abbrev-ref',
			'--symbolic-full-name',
			`${baseRef}@{upstream}`,
		]);

		if (upstream.status === 'success' && upstream.stdout.trim()) {
			candidates.push(upstream.stdout.trim());
		}

		return [...new Set(candidates)];
	}

	/**
	 * Each candidate's merge-base with HEAD, skipping the ones that do not
	 * resolve. Sequential on purpose: concurrent git invocations contend for the
	 * repository's single index lock and fail intermittently.
	 * @param cwd - Workspace worktree to resolve in.
	 * @param candidates - Refs to intersect with HEAD.
	 * @returns The distinct merge-base commits found.
	 */
	async function mergeBasesWithHead(
		cwd: string,
		candidates: readonly string[],
	): Promise<string[]> {
		const mergeBases = new Set<string>();

		for (const candidate of candidates) {
			// oxlint-disable-next-line react-doctor/async-await-in-loop
			const result = await runGit(cwd, ['merge-base', candidate, 'HEAD']);

			if (result.status === 'success' && result.stdout.trim()) {
				mergeBases.add(result.stdout.trim());
			}
		}

		return [...mergeBases];
	}

	/**
	 * The merge-base nearest HEAD, so a remote that advanced again does not drag
	 * the reported fork point back past commits this workspace already owns.
	 * `merge-base --is-ancestor a b` exits zero exactly when `b` is the
	 * descendant; two unrelated bases keep the first, which no ordering improves.
	 * Sequential for the same index-lock reason as {@link mergeBasesWithHead}.
	 * @param cwd - Workspace worktree to resolve in.
	 * @param mergeBases - Two or more distinct merge-base commits.
	 * @returns The nearest commit.
	 */
	async function nearestToHead(
		cwd: string,
		mergeBases: readonly string[],
	): Promise<string | null> {
		let nearest = mergeBases[0] ?? null;

		for (const candidate of mergeBases.slice(1)) {
			// oxlint-disable-next-line react-doctor/async-await-in-loop
			const isNearer = await runGit(cwd, [
				'merge-base',
				'--is-ancestor',
				nearest ?? candidate,
				candidate,
			]);

			if (isNearer.status === 'success') {
				nearest = candidate;
			}
		}

		return nearest;
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
	/**
	 * The untracked paths whose lines are worth counting: the first
	 * {@link MAX_COUNTED_UNTRACKED_FILES} in the order git reported them.
	 * @param entries - Status rows for the change set, untracked or not.
	 * @returns The set of untracked paths that get a real line count.
	 */
	function countableUntrackedPaths(
		entries: readonly { path: string; status: string }[],
	): ReadonlySet<string> {
		return new Set(
			entries
				.filter((entry) => entry.status === 'untracked')
				.slice(0, MAX_COUNTED_UNTRACKED_FILES)
				.map((entry) => entry.path),
		);
	}

	/**
	 * Line counts for one untracked file, or a null pair when the change set has
	 * more untracked files than {@link MAX_COUNTED_UNTRACKED_FILES}.
	 * @param cwd - Absolute workspace directory the path is relative to.
	 * @param relativePath - Untracked path to count.
	 * @param countable - Paths admitted by {@link countableUntrackedPaths}.
	 * @returns The row's addition and deletion counts.
	 */
	async function untrackedCounts(
		cwd: string,
		relativePath: string,
		countable: ReadonlySet<string>,
	): Promise<{ additions: number | null; deletions: number | null }> {
		if (!countable.has(relativePath)) {
			return { additions: null, deletions: null };
		}
		return countUntrackedLines(cwd, relativePath);
	}

	/**
	 * Counts the lines in one untracked file, reading at most
	 * {@link MAX_UNTRACKED_COUNT_BYTES}. A file whose head contains a NUL byte is
	 * binary and reports null counts, as a tracked binary row does.
	 * @param cwd - Absolute workspace directory the path is relative to.
	 * @param relativePath - Untracked path to read.
	 * @returns The row's addition and deletion counts.
	 */
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
				for (
					let at = buffer.indexOf(0x0a);
					at !== -1;
					at = buffer.indexOf(0x0a, at + 1)
				) {
					lines += 1;
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
					message: gitFailureMessage(restore, `Could not restore ${relPath}.`),
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
					message: gitFailureMessage(unstage, `Could not unstage ${relPath}.`),
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

/**
 * Stamp of one working-tree file's current bytes.
 *
 * Size and modification time rather than a content hash: git's own index uses
 * the same pair to decide a file is dirty, while hashing would cost a
 * `git hash-object` process per changed row on every status poll. The trade is
 * deliberate — the stamp can change when the bytes did not (a rewrite with
 * identical content), which expires a mark that need not have expired, but it
 * cannot stay the same across a real edit, which is the failure that matters.
 * @param cwd - Absolute workspace directory the path is relative to
 * @param relativePath - Workspace-relative path to stamp
 * @returns An opaque stamp, or null when the path is gone or unreadable
 */
async function readContentId(
	cwd: string,
	relativePath: string,
): Promise<string | null> {
	try {
		const stats = await stat(path.join(cwd, relativePath));
		return stats.isFile() ? `${stats.size}:${stats.mtimeMs}` : null;
	} catch {
		return null;
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
	error: WorkspaceGitFailure,
): GetWorkspaceGitStatusResult {
	return {
		error,
		files: [],
		summary: { additions: 0, deletions: 0, files: 0 },
	};
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
