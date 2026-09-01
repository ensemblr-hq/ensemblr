import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

import type {
	LocalCommandResult,
	LocalCommandService,
} from '../commands/local-command';
import { firstLine } from './first-line.ts';
import { removeDirectoryTree } from './remove-directory.ts';

/** Outcome of a git operation that the caller maps to its own diagnostic code. */
type GitOpOutcome =
	| { status: 'success' }
	| { status: 'no-branch' }
	| { status: 'failure'; message: string };

/**
 * Outcome of a `git worktree add` that the caller maps to its own diagnostic
 * code. `git-missing` is split from generic failure so callers can surface a
 * tailored install hint.
 */
type GitWorktreeAddOutcome =
	| { status: 'success' }
	| { status: 'git-missing'; message: string }
	| { status: 'failure'; message: string };

/**
 * Outcome of a best-effort base-ref sync. `synced` means the base now reflects
 * the latest remote; `skipped` means the sync could not run or advance (offline,
 * no upstream, divergence, dirty tree) and the caller should proceed from the
 * existing local base. Sync is a convenience, never a hard failure.
 */
type GitBaseRefSyncOutcome = { status: 'synced' } | { status: 'skipped' };

/** Parsed reference to a branch hosted by a configured Git remote. */
interface RemoteBranchRef {
	branch: string;
	remote: string;
}

/** Default branch used when a repository has no recorded default. */
export const DEFAULT_FALLBACK_BRANCH = 'main';

const GIT_BRANCH_TIMEOUT_MS = 5_000;
const GIT_FETCH_TIMEOUT_MS = 30_000;
export const GIT_WORKTREE_TIMEOUT_MS = 15_000;

/**
 * `git worktree add` checks out the entire base tree, which on a cold OS file
 * cache or a large repository legitimately takes far longer than the 15s used
 * for git's fast metadata queries. The previous 15s cap killed slow-but-healthy
 * checkouts, surfacing git's harmless "Preparing worktree" progress line as the
 * failure; a generous cap lets the checkout finish on the first attempt.
 */
const GIT_WORKTREE_ADD_TIMEOUT_MS = 120_000;

/**
 * `git worktree remove --force` unlinks the whole checkout, which for a
 * dependency-heavy worktree is tens of thousands of inodes — measured here at
 * ~3s warm on 69k, and several times that on a cold file cache. It belongs with
 * `add` rather than with git's fast metadata queries: the 15s cap now really
 * does terminate the command, so a tight one would turn a slow-but-healthy
 * removal into a failure that leaves half the tree behind.
 */
const GIT_WORKTREE_REMOVE_TIMEOUT_MS = 120_000;

/** How many times to attempt `git worktree add` when it fails transiently. */
const GIT_WORKTREE_ADD_MAX_ATTEMPTS = 3;

/** Base backoff between `git worktree add` retries; scales with the attempt. */
const GIT_WORKTREE_ADD_RETRY_DELAY_MS = 250;

/**
 * Matches the transient git lock-contention failures a retry resolves: another
 * git process in the same repository briefly held `index.lock`, a ref lock, or
 * the config lock. These fail fast (git does not wait on an existing lock), so
 * retrying after a short delay is cheap and usually succeeds.
 */
const GIT_LOCK_CONTENTION =
	/(index\.lock|ref[\w-]*\.lock|\.lock': File exists|could not lock|unable to create.*\.lock|another git process)/i;

/** git stderr progress lines that precede — and must not mask — a real error. */
const GIT_PROGRESS_PREFIXES = [
	'Preparing worktree',
	'HEAD is now at',
	'Updating files',
	'Checking out files',
] as const;

/**
 * Best-effort sync of a workspace base ref to the latest remote before a new
 * branch is created from it. Fetches the backing remote branch and fast-forwards
 * the local base when possible. Every failure mode (offline, no upstream,
 * divergence, dirty tree, base checked out elsewhere) degrades to `skipped` so
 * workspace creation still proceeds from the existing local base.
 * @param options - Base branch and Git command dependencies.
 * @returns Whether the base was synced or the sync was skipped.
 */
export async function syncBaseRef({
	baseBranch,
	localCommandService,
	repositoryPath,
}: {
	baseBranch: string;
	localCommandService: LocalCommandService;
	repositoryPath: string;
}): Promise<GitBaseRefSyncOutcome> {
	const remoteRef = await resolveConfiguredRemoteRef({
		baseBranch,
		localCommandService,
		repositoryPath,
	});
	if (remoteRef) {
		const fetched = await fetchRemoteRef({
			localCommandService,
			remoteRef,
			repositoryPath,
		});
		return fetched ? { status: 'synced' } : { status: 'skipped' };
	}

	const upstreamRef =
		(await readUpstreamRef({
			baseBranch,
			localCommandService,
			repositoryPath,
		})) ??
		(await readOriginTrackingRef({
			branch: baseBranch,
			localCommandService,
			repositoryPath,
		}));
	if (!upstreamRef) {
		return { status: 'skipped' };
	}

	const upstreamRemoteRef = await resolveConfiguredRemoteRef({
		baseBranch: upstreamRef,
		localCommandService,
		repositoryPath,
	});
	if (!upstreamRemoteRef) {
		return { status: 'skipped' };
	}

	const fetched = await fetchRemoteRef({
		localCommandService,
		remoteRef: upstreamRemoteRef,
		repositoryPath,
	});
	if (!fetched) {
		return { status: 'skipped' };
	}

	return advanceLocalBase({
		baseBranch,
		localCommandService,
		repositoryPath,
		upstreamRef,
	});
}

/**
 * Fast-forwards a local base branch to its freshly fetched upstream when the
 * update is a clean fast-forward. A base that already contains the upstream is a
 * no-op success; divergence or a failed advance (dirty tree, base checked out in
 * another worktree) degrades to `skipped`.
 * @param options - Base branch, upstream ref, and Git command dependencies.
 * @returns Whether the base was advanced or the advance was skipped.
 */
async function advanceLocalBase({
	baseBranch,
	localCommandService,
	repositoryPath,
	upstreamRef,
}: {
	baseBranch: string;
	localCommandService: LocalCommandService;
	repositoryPath: string;
	upstreamRef: string;
}): Promise<GitBaseRefSyncOutcome> {
	const alreadyContainsUpstream = await runGitSucceeds({
		args: ['merge-base', '--is-ancestor', upstreamRef, baseBranch],
		localCommandService,
		repositoryPath,
	});
	if (alreadyContainsUpstream) {
		return { status: 'synced' };
	}

	const canFastForward = await runGitSucceeds({
		args: ['merge-base', '--is-ancestor', baseBranch, upstreamRef],
		localCommandService,
		repositoryPath,
	});
	if (!canFastForward) {
		return { status: 'skipped' };
	}

	const currentBranch = await runGitText({
		args: ['rev-parse', '--abbrev-ref', 'HEAD'],
		localCommandService,
		repositoryPath,
	});
	const advanced =
		currentBranch === baseBranch
			? await runGitSucceeds({
					args: ['merge', '--ff-only', upstreamRef],
					localCommandService,
					repositoryPath,
				})
			: await runGitSucceeds({
					args: ['branch', '--force', baseBranch, upstreamRef],
					localCommandService,
					repositoryPath,
				});
	return advanced ? { status: 'synced' } : { status: 'skipped' };
}

/**
 * How `git worktree add` puts `branchName` into the new worktree: cut it fresh
 * at a fork point, move an existing local branch across, or create it from a
 * remote-tracking ref for a branch that only exists on the remote so far.
 */
export type WorktreeBranchPlacement =
	| { forkRef: string; kind: 'create' }
	| { kind: 'checkout' }
	| { kind: 'track'; remoteRef: string };

/**
 * Builds the `git worktree add` argv for a branch placement.
 * @param options - Branch name, placement, and destination path.
 * @returns The argument list to pass after `git`.
 */
function worktreeAddArgs({
	branchName,
	placement,
	workspacePath,
}: {
	branchName: string;
	placement: WorktreeBranchPlacement;
	workspacePath: string;
}): string[] {
	switch (placement.kind) {
		case 'checkout':
			return ['worktree', 'add', workspacePath, branchName];
		case 'create':
			return [
				'worktree',
				'add',
				'-b',
				branchName,
				workspacePath,
				placement.forkRef,
			];
		case 'track':
			return [
				'worktree',
				'add',
				'--track',
				'-b',
				branchName,
				workspacePath,
				placement.remoteRef,
			];
	}
}

/**
 * Adds a new git worktree at `workspacePath` with `branchName` checked out,
 * placed according to {@link WorktreeBranchPlacement}.
 *
 * Returns `git-missing` when the git binary is not on PATH so callers can
 * surface an install hint distinct from generic failures.
 */
export async function runWorktreeAdd({
	branchName,
	localCommandService,
	placement,
	repositoryPath,
	workspacePath,
}: {
	branchName: string;
	localCommandService: LocalCommandService;
	placement: WorktreeBranchPlacement;
	repositoryPath: string;
	workspacePath: string;
}): Promise<GitWorktreeAddOutcome> {
	const args = worktreeAddArgs({ branchName, placement, workspacePath });

	let lastFailure: GitWorktreeAddOutcome = {
		status: 'failure',
		message: 'git worktree add failed.',
	};

	for (
		let attempt = 1;
		attempt <= GIT_WORKTREE_ADD_MAX_ATTEMPTS;
		attempt += 1
	) {
		const outcome = await attemptWorktreeAdd({
			args,
			localCommandService,
			repositoryPath,
		});

		if (outcome.status === 'success' || outcome.status === 'git-missing') {
			return outcome;
		}

		lastFailure = { status: 'failure', message: outcome.message };

		if (!outcome.transient || attempt === GIT_WORKTREE_ADD_MAX_ATTEMPTS) {
			return lastFailure;
		}

		// Clear any half-written worktree admin entry the failed attempt left
		// behind so the retry starts from a clean registry.
		await runWorktreePrune({ localCommandService, repositoryPath });
		await delay(GIT_WORKTREE_ADD_RETRY_DELAY_MS * attempt);
	}

	return lastFailure;
}

/** Per-attempt outcome, adding `transient` so the caller can decide to retry. */
type WorktreeAddAttempt =
	| { status: 'success' }
	| { status: 'git-missing'; message: string }
	| { status: 'failure'; message: string; transient: boolean };

/**
 * Runs a single `git worktree add` invocation and classifies its outcome. A
 * lock-contention failure is flagged `transient` so the caller retries it; a
 * timeout or a real git error is reported with an actionable message rather
 * than git's harmless "Preparing worktree" progress preamble.
 * @param options - Prebuilt args and Git command dependencies.
 * @returns The classified attempt outcome.
 */
async function attemptWorktreeAdd({
	args,
	localCommandService,
	repositoryPath,
}: {
	args: string[];
	localCommandService: LocalCommandService;
	repositoryPath: string;
}): Promise<WorktreeAddAttempt> {
	try {
		const result = await localCommandService.run({
			args,
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes: 64 * 1024,
			timeoutMs: GIT_WORKTREE_ADD_TIMEOUT_MS,
		});

		if (result.status === 'success') {
			return { status: 'success' };
		}

		if (result.failure?.code === 'command-not-found') {
			return {
				status: 'git-missing',
				message: 'git was not found in PATH. Install git, then retry.',
			};
		}

		return {
			status: 'failure',
			message: describeWorktreeAddFailure(result),
			transient: GIT_LOCK_CONTENTION.test(result.stderr),
		};
	} catch (error) {
		return {
			status: 'failure',
			message:
				error instanceof Error
					? error.message
					: 'git worktree add threw unexpectedly.',
			transient: false,
		};
	}
}

/**
 * Turns a failed `git worktree add` result into a user-facing message. Timeouts
 * and cancellations are reported explicitly; every other failure surfaces the
 * real git error line, never the "Preparing worktree" progress preamble git
 * prints to stderr before it does any work.
 * @param result - The failed command result.
 * @returns A concise, actionable failure message.
 */
function describeWorktreeAddFailure(result: LocalCommandResult): string {
	if (result.failure?.code === 'timeout') {
		const seconds = Math.round(GIT_WORKTREE_ADD_TIMEOUT_MS / 1000);
		return `git worktree add timed out after ${seconds}s. Close other git operations on this repository and retry.`;
	}

	if (result.failure?.code === 'canceled') {
		return 'git worktree add was canceled.';
	}

	return extractGitError(result.stderr) || 'git worktree add failed.';
}

/**
 * Extracts the meaningful git error from stderr: the last `fatal:`/`error:`
 * line when present, otherwise the last line that is not a known progress
 * preamble. Returns an empty string when stderr carries only progress output.
 * @param stderr - Raw stderr from the git process.
 * @returns The real error line, or an empty string.
 */
function extractGitError(stderr: string): string {
	const lines = stderr
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const fatal = lines.findLast((line) => /^(fatal|error):/i.test(line));
	if (fatal) {
		return fatal;
	}
	return lines.findLast((line) => !isGitProgressLine(line)) ?? '';
}

/** Reports whether a stderr line is one of git's benign progress preambles. */
function isGitProgressLine(line: string): boolean {
	return GIT_PROGRESS_PREFIXES.some((prefix) => line.startsWith(prefix));
}

/**
 * Best-effort `git worktree prune` to drop stale worktree admin entries — ones
 * whose directory is gone while their registration survives. Failures are
 * ignored: every caller has its own report for the problem pruning was meant to
 * clear, and none of them can act on the prune itself failing.
 * @param options - Git command dependencies.
 */
export async function runWorktreePrune({
	localCommandService,
	repositoryPath,
}: {
	localCommandService: LocalCommandService;
	repositoryPath: string;
}): Promise<void> {
	await runGitSucceeds({
		args: ['worktree', 'prune'],
		localCommandService,
		repositoryPath,
		timeoutMs: GIT_WORKTREE_TIMEOUT_MS,
	});
}

/**
 * Resolves after `ms` milliseconds; used to space out worktree-add retries.
 * @param ms - Delay in milliseconds.
 */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolves the repository's root branch for new workspaces. Prefers the remote's
 * published default (`origin/HEAD`); when that is not recorded locally, falls
 * back to a local `main` then `master`. Returns null when none is found so the
 * caller can fall back to the stored default.
 *
 * This is resolved live at workspace creation (not read from the stored
 * `default_branch` column) so the "+" button always branches from the current
 * root, even when the repo was registered on a feature branch or its default
 * has since changed.
 */
export async function resolveRootBranch({
	localCommandService,
	repositoryPath,
}: {
	localCommandService: LocalCommandService;
	repositoryPath: string;
}): Promise<string | null> {
	const originHead = await runGitText({
		args: ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
		localCommandService,
		repositoryPath,
	});
	if (originHead) {
		const slashAt = originHead.indexOf('/');
		const branch = slashAt >= 0 ? originHead.slice(slashAt + 1) : originHead;
		if (branch) {
			return branch;
		}
	}

	for (const candidate of ['main', 'master']) {
		const exists = await runGitSucceeds({
			args: ['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`],
			localCommandService,
			repositoryPath,
		});
		if (exists) {
			return candidate;
		}
	}

	return null;
}

/**
 * Resolves a `<remote>/<branch>` ref only when the prefix is a configured remote.
 * @param options - Candidate ref and Git command dependencies.
 * @returns The parsed remote ref, or `null` for local branch refs.
 */
async function resolveConfiguredRemoteRef({
	baseBranch,
	localCommandService,
	repositoryPath,
}: {
	baseBranch: string;
	localCommandService: LocalCommandService;
	repositoryPath: string;
}): Promise<RemoteBranchRef | null> {
	const separator = baseBranch.indexOf('/');
	if (separator <= 0 || separator === baseBranch.length - 1) {
		return null;
	}
	const remote = baseBranch.slice(0, separator);
	const branch = baseBranch.slice(separator + 1);
	const remoteUrl = await runGitText({
		args: ['remote', 'get-url', remote],
		localCommandService,
		repositoryPath,
	});
	return remoteUrl ? { branch, remote } : null;
}

/**
 * Reads the configured upstream for a local branch.
 * @param options - Local branch and Git command dependencies.
 * @returns The upstream ref, or `null` when none is configured.
 */
async function readUpstreamRef({
	baseBranch,
	localCommandService,
	repositoryPath,
}: {
	baseBranch: string;
	localCommandService: LocalCommandService;
	repositoryPath: string;
}): Promise<string | null> {
	const upstreamRef = await runGitText({
		args: [
			'rev-parse',
			'--abbrev-ref',
			'--symbolic-full-name',
			`${baseBranch}@{upstream}`,
		],
		localCommandService,
		repositoryPath,
	});
	return upstreamRef || null;
}

/**
 * Resolves an existing `origin/<branch>` tracking ref — the fallback when a
 * local branch has no upstream set, and the start point when a workspace adopts
 * a branch that exists only on the remote.
 * @param options - Local branch and Git command dependencies.
 * @returns The origin tracking ref, or `null` when none is available.
 */
export async function readOriginTrackingRef({
	branch,
	localCommandService,
	repositoryPath,
}: {
	branch: string;
	localCommandService: LocalCommandService;
	repositoryPath: string;
}): Promise<string | null> {
	const remote = 'origin';
	const remoteUrl = await runGitText({
		args: ['remote', 'get-url', remote],
		localCommandService,
		repositoryPath,
	});
	if (!remoteUrl) {
		return null;
	}

	const trackingRef = `${remote}/${branch}`;
	const exists = await runGitSucceeds({
		args: ['show-ref', '--verify', '--quiet', `refs/remotes/${trackingRef}`],
		localCommandService,
		repositoryPath,
	});
	return exists ? trackingRef : null;
}

/**
 * Lists every local branch, plus the trailing segment of each prefixed one.
 *
 * `git worktree add -b <name>` refuses a name any local branch already holds,
 * and a branch outlives the workspace that cut it, so a caller allocating a name
 * has to steer around branches no database row mentions. Segments are included
 * because callers allocate the slug, not the whole prefixed branch: `bach` has
 * to read as taken when `octocat/bach` exists.
 * @param options - Git command dependencies.
 * @returns Lowercased branch names and segments; empty when git cannot answer.
 */
export async function listLocalBranchNames({
	localCommandService,
	repositoryPath,
}: {
	localCommandService: LocalCommandService;
	repositoryPath: string;
}): Promise<Set<string>> {
	const stdout = await runGitText({
		args: ['for-each-ref', '--format=%(refname:short)', 'refs/heads'],
		localCommandService,
		maxOutputBytes: 1024 * 1024,
		repositoryPath,
	});
	const names = new Set<string>();
	for (const line of (stdout ?? '').split('\n')) {
		const branch = line.trim().toLowerCase();
		if (!branch) {
			continue;
		}
		names.add(branch);
		names.add(branch.slice(branch.lastIndexOf('/') + 1));
	}
	return names;
}

/**
 * Verifies that a ref resolves to a commit inside the repository, so a stale
 * configured base or a branch that exists nowhere is caught before it reaches a
 * worktree command.
 * @param options - Candidate ref plus git command dependencies.
 * @returns True when `git rev-parse` resolves the ref.
 */
export async function refResolvesToCommit({
	localCommandService,
	ref,
	repositoryPath,
}: {
	localCommandService: LocalCommandService;
	ref: string;
	repositoryPath: string;
}): Promise<boolean> {
	try {
		const result = await localCommandService.run({
			args: ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes: 4 * 1024,
			timeoutMs: GIT_WORKTREE_TIMEOUT_MS,
		});
		return result.status === 'success';
	} catch {
		return false;
	}
}

/**
 * Ensures a ref resolves locally before a worktree command needs it. When it
 * does not (e.g. a pull-request head like `origin/feature-x` that was never
 * fetched), attempts a best-effort `git fetch <remote> <branch>`. Already-present
 * refs (local branches, fetched remotes) skip the fetch. All failures are
 * swallowed — the worktree command surfaces the real, actionable error if the
 * ref is still missing afterward.
 * @param options - Candidate ref plus git command dependencies.
 */
export async function ensureBaseRefAvailable({
	baseBranch,
	localCommandService,
	repositoryPath,
}: {
	baseBranch: string;
	localCommandService: LocalCommandService;
	repositoryPath: string;
}): Promise<void> {
	try {
		// The probe runs inline rather than through `refResolvesToCommit`, which
		// swallows throws: a git binary that cannot run at all must skip the fetch
		// too, not fall through to a second doomed invocation.
		const verify = await localCommandService.run({
			args: ['rev-parse', '--verify', '--quiet', `${baseBranch}^{commit}`],
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes: 4 * 1024,
			timeoutMs: GIT_WORKTREE_TIMEOUT_MS,
		});
		if (verify.status === 'success') {
			return;
		}

		const separator = baseBranch.indexOf('/');
		if (separator <= 0) {
			return;
		}
		await localCommandService.run({
			args: [
				'fetch',
				baseBranch.slice(0, separator),
				baseBranch.slice(separator + 1),
			],
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes: 64 * 1024,
			timeoutMs: GIT_FETCH_TIMEOUT_MS,
		});
	} catch {
		// Best effort: leave it to the worktree command to report a missing ref.
	}
}

/**
 * Fetches a remote branch that may be used as a new workspace base. Best-effort:
 * a fetch that fails (e.g. offline) simply reports false so the caller can fall
 * back to the local base.
 * @param options - Remote ref and Git command dependencies.
 * @returns True when the fetch succeeded.
 */
async function fetchRemoteRef({
	localCommandService,
	remoteRef,
	repositoryPath,
}: {
	localCommandService: LocalCommandService;
	remoteRef: RemoteBranchRef;
	repositoryPath: string;
}): Promise<boolean> {
	return runGitSucceeds({
		args: ['fetch', remoteRef.remote, remoteRef.branch],
		localCommandService,
		maxOutputBytes: 64 * 1024,
		repositoryPath,
		timeoutMs: GIT_FETCH_TIMEOUT_MS,
	});
}

/** Runs a read-only git command, returning trimmed stdout (empty on failure). */
async function runGitText({
	args,
	localCommandService,
	maxOutputBytes = 16 * 1024,
	repositoryPath,
}: {
	args: string[];
	localCommandService: LocalCommandService;
	maxOutputBytes?: number;
	repositoryPath: string;
}): Promise<string> {
	try {
		const result = await localCommandService.run({
			args,
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes,
			timeoutMs: GIT_BRANCH_TIMEOUT_MS,
		});
		return result.status === 'success' ? result.stdout.trim() : '';
	} catch {
		return '';
	}
}

/** Runs a git command and reports whether it exited successfully. */
async function runGitSucceeds({
	args,
	localCommandService,
	maxOutputBytes = 4 * 1024,
	repositoryPath,
	timeoutMs = GIT_BRANCH_TIMEOUT_MS,
}: {
	args: string[];
	localCommandService: LocalCommandService;
	maxOutputBytes?: number;
	repositoryPath: string;
	timeoutMs?: number;
}): Promise<boolean> {
	try {
		const result = await localCommandService.run({
			args,
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes,
			timeoutMs,
		});
		return result.status === 'success';
	} catch {
		return false;
	}
}

/**
 * Removes a worktree's registration and its directory, reporting success only
 * once the directory is actually gone.
 *
 * `git worktree remove` aborts its recursive delete on the first entry it
 * cannot unlink — a `.DS_Store` Finder writes into a directory mid-walk makes
 * the following `rmdir` return `ENOTEMPTY`, which is enough — and then drops
 * `.git/worktrees/<id>` anyway before exiting non-zero. The tree is left whole
 * on disk as a worktree git no longer knows about, so no later git command can
 * remove it and the disk is never reclaimed. The directory is therefore
 * unlinked directly when it survives an unregistration, which retries that
 * race rather than abandoning the whole walk to it.
 *
 * Unregistration is the condition, not the surviving directory: git also
 * refuses a *locked* worktree, and that refusal keeps both the registration and
 * the tree intact. Unlinking there would destroy a worktree the user marked
 * do-not-touch, leave `.git/worktrees/<id>` pointing at nothing — `git worktree
 * prune` skips a locked entry, so permanently — and break the `git branch -D`
 * this removal exists to enable, which still reports the branch as checked out.
 * A caller deleting the workspace outright says so with `deletingWorkspace`.
 * Git's refusal preserves nothing there, so the lock is released and the
 * removal retried — keeping git's own bookkeeping consistent rather than
 * stepping around it — and an unanswerable registration no longer holds the
 * directory back either.
 *
 * Unlinking under a registration that survived all of that strands the
 * registration: git keeps listing an entry pointing at nothing, and the branch
 * keeps reading as checked out — to the `git branch -D` that follows, and to
 * every later workspace creation. A `git worktree prune` therefore runs before
 * this returns, which is exactly the case git's own pruning was written for
 * now that the directory is gone.
 * @param options - Repository path, worktree path, delete intent, and the command runner.
 * @returns Success once the directory is gone, or why it could not be removed.
 */
export async function runWorktreeRemove({
	deletingWorkspace = false,
	localCommandService,
	repositoryPath,
	workspacePath,
}: {
	/** True when the workspace itself is going, so git's refusal preserves nothing. */
	deletingWorkspace?: boolean;
	localCommandService: LocalCommandService;
	repositoryPath: string;
	workspacePath: string;
}): Promise<GitOpOutcome> {
	const attempt = await removeWorktreeUntilUnregistered({
		deletingWorkspace,
		localCommandService,
		repositoryPath,
		workspacePath,
	});
	if (attempt.state === 'gone') {
		return { status: 'success' };
	}
	if (attempt.state === 'registered' && !deletingWorkspace) {
		return { status: 'failure', message: attempt.message };
	}

	const removal = await removeDirectoryTree(workspacePath);
	if (!removal.removed) {
		return { status: 'failure', message: removal.error ?? attempt.message };
	}

	if (attempt.state === 'registered') {
		await runWorktreePrune({ localCommandService, repositoryPath });
	}

	return { status: 'success' };
}

/**
 * Runs git's own removal, retrying once past a lock when the caller's intent
 * allows it, and reports which of the three states the worktree ended in.
 *
 * `registered` is the state a prune must never unlink behind git's back:
 * either git still owns the worktree, or it could not be asked and the answer
 * is unknown.
 * @param options - Repository path, worktree path, delete intent, and the command runner.
 * @returns Whether the directory is gone, still registered, or an orphan on disk.
 */
async function removeWorktreeUntilUnregistered({
	deletingWorkspace,
	localCommandService,
	repositoryPath,
	workspacePath,
}: {
	deletingWorkspace: boolean;
	localCommandService: LocalCommandService;
	repositoryPath: string;
	workspacePath: string;
}): Promise<WorktreeRemovalState> {
	const first = await attemptWorktreeRemoval({
		localCommandService,
		repositoryPath,
		workspacePath,
	});
	if (first.state !== 'registered' || !deletingWorkspace) {
		return first;
	}

	await runWorktreeUnlock({
		localCommandService,
		repositoryPath,
		workspacePath,
	});
	return await attemptWorktreeRemoval({
		localCommandService,
		repositoryPath,
		workspacePath,
	});
}

/** Where a single `git worktree remove` left the worktree. */
type WorktreeRemovalState =
	| { state: 'gone' }
	| { state: 'orphaned'; message: string }
	| { state: 'registered'; message: string };

/**
 * Runs git's removal once and classifies what survived it.
 * @param options - Repository path, worktree path, and the command runner.
 * @returns Whether the directory is gone, still registered, or an orphan on disk.
 */
async function attemptWorktreeRemoval({
	localCommandService,
	repositoryPath,
	workspacePath,
}: {
	localCommandService: LocalCommandService;
	repositoryPath: string;
	workspacePath: string;
}): Promise<WorktreeRemovalState> {
	const gitOutcome = await removeWorktreeWithGit({
		localCommandService,
		repositoryPath,
		workspacePath,
	});
	if (!existsSync(workspacePath)) {
		return { state: 'gone' };
	}

	const message =
		gitOutcome.status === 'failure'
			? gitOutcome.message
			: `The worktree directory ${workspacePath} is still on disk.`;
	const registered = await isWorktreeRegistered({
		localCommandService,
		repositoryPath,
		workspacePath,
	});
	return registered === false
		? { state: 'orphaned', message }
		: { state: 'registered', message };
}

/**
 * Releases a `git worktree lock` so a delete can proceed through git rather
 * than around it. Best-effort: the retry that follows reports the real outcome.
 * @param options - Repository path, worktree path, and the command runner.
 */
async function runWorktreeUnlock({
	localCommandService,
	repositoryPath,
	workspacePath,
}: {
	localCommandService: LocalCommandService;
	repositoryPath: string;
	workspacePath: string;
}): Promise<void> {
	try {
		await localCommandService.run({
			args: ['worktree', 'unlock', workspacePath],
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes: 4 * 1024,
			timeoutMs: GIT_WORKTREE_TIMEOUT_MS,
		});
	} catch {
		return;
	}
}

/**
 * Asks git whether it still knows the path as one of the repository's
 * worktrees, which is what separates a removal that unregistered and then
 * failed to delete from one git refused outright.
 *
 * A list that cannot be read or parsed answers null rather than false: the
 * caller unlinks a directory on the strength of this answer, so "git did not
 * say" must not read as "git dropped it".
 * @param options - Repository path, worktree path, and the command runner.
 * @returns Whether the path is registered, or null when git could not be asked.
 */
async function isWorktreeRegistered({
	localCommandService,
	repositoryPath,
	workspacePath,
}: {
	localCommandService: LocalCommandService;
	repositoryPath: string;
	workspacePath: string;
}): Promise<boolean | null> {
	try {
		const result = await localCommandService.run({
			args: ['worktree', 'list', '--porcelain'],
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes: 256 * 1024,
			timeoutMs: GIT_WORKTREE_TIMEOUT_MS,
		});
		if (result.status !== 'success') {
			return null;
		}
		const target = canonicalPath(workspacePath);
		return result.stdout
			.split(/\r?\n/)
			.filter((line) => line.startsWith('worktree '))
			.some((line) => canonicalPath(line.slice('worktree '.length)) === target);
	} catch {
		return null;
	}
}

/**
 * Resolves a path to the form git prints, so `/tmp` and `/private/tmp` compare
 * equal on macOS. An unresolvable path falls back to its normalized form.
 * @param candidate - Path to canonicalize.
 * @returns The real path when it resolves, or the normalized path.
 */
function canonicalPath(candidate: string): string {
	const normalized = path.resolve(candidate.trim());
	try {
		return realpathSync.native(normalized);
	} catch {
		return normalized;
	}
}

/**
 * Runs `git worktree remove --force`, which unregisters the worktree and tries
 * to delete its directory.
 * @param options - Repository path, worktree path, and the command runner.
 * @returns What git reported, which says nothing about the directory itself.
 */
async function removeWorktreeWithGit({
	localCommandService,
	repositoryPath,
	workspacePath,
}: {
	localCommandService: LocalCommandService;
	repositoryPath: string;
	workspacePath: string;
}): Promise<GitOpOutcome> {
	try {
		const result = await localCommandService.run({
			args: ['worktree', 'remove', '--force', workspacePath],
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes: 16 * 1024,
			timeoutMs: GIT_WORKTREE_REMOVE_TIMEOUT_MS,
		});

		if (result.status === 'success') {
			return { status: 'success' };
		}

		return {
			status: 'failure',
			message:
				firstLine(result.stderr) ||
				`git worktree remove --force exited with status ${result.status}.`,
		};
	} catch (error) {
		return {
			status: 'failure',
			message:
				error instanceof Error
					? error.message
					: 'git worktree remove --force threw unexpectedly.',
		};
	}
}

/**
 * Deletes a private ref, so purging an archive also drops the snapshot pinning
 * its commits against `git gc`. Best-effort: a ref that was never written, or
 * one already gone, is the expected case rather than a failure.
 * @param options - Ref to delete plus git command dependencies.
 */
export async function runRefDelete({
	localCommandService,
	ref,
	repositoryPath,
}: {
	localCommandService: LocalCommandService;
	ref: string;
	repositoryPath: string;
}): Promise<void> {
	try {
		await localCommandService.run({
			args: ['update-ref', '-d', ref],
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes: 4 * 1024,
			timeoutMs: GIT_BRANCH_TIMEOUT_MS,
		});
	} catch {
		// Nothing downstream depends on the ref being gone; the objects it held
		// become unreachable with the branch and are collected on the next gc.
	}
}

/**
 * Drops a local branch. Returns `no-branch` when the branch was already missing
 * so callers can distinguish "expected absence" from real failures.
 */
export async function runBranchDelete({
	branchName,
	localCommandService,
	repositoryPath,
}: {
	branchName: string;
	localCommandService: LocalCommandService;
	repositoryPath: string;
}): Promise<GitOpOutcome> {
	try {
		const result = await localCommandService.run({
			args: ['branch', '-D', branchName],
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes: 16 * 1024,
			timeoutMs: GIT_BRANCH_TIMEOUT_MS,
		});

		if (result.status === 'success') {
			return { status: 'success' };
		}

		const stderr = result.stderr || '';
		if (stderr.includes('not found') || stderr.includes('No such branch')) {
			return { status: 'no-branch' };
		}

		return {
			status: 'failure',
			message: firstLine(stderr) || 'git branch -D failed.',
		};
	} catch (error) {
		return {
			status: 'failure',
			message:
				error instanceof Error
					? error.message
					: 'git branch -D threw unexpectedly.',
		};
	}
}
