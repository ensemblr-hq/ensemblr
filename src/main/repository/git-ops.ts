import type { LocalCommandService } from '../commands/local-command';
import { firstLine } from './first-line.ts';

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
			baseBranch,
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
 * Adds a new git worktree at `workspacePath`. When `createBranch` is true
 * (default), uses `-b <branchName>` to create the branch from `baseBranch`;
 * otherwise checks out the existing branch at the worktree path.
 *
 * Returns `git-missing` when the git binary is not on PATH so callers can
 * surface an install hint distinct from generic failures.
 */
export async function runWorktreeAdd({
	baseBranch,
	branchName,
	createBranch = true,
	localCommandService,
	repositoryPath,
	workspacePath,
}: {
	baseBranch: string;
	branchName: string;
	createBranch?: boolean;
	localCommandService: LocalCommandService;
	repositoryPath: string;
	workspacePath: string;
}): Promise<GitWorktreeAddOutcome> {
	const args = createBranch
		? ['worktree', 'add', '-b', branchName, workspacePath, baseBranch]
		: ['worktree', 'add', workspacePath, branchName];

	try {
		const result = await localCommandService.run({
			args,
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes: 64 * 1024,
			timeoutMs: GIT_WORKTREE_TIMEOUT_MS,
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
			message: firstLine(result.stderr) || 'git worktree add failed.',
		};
	} catch (error) {
		return {
			status: 'failure',
			message:
				error instanceof Error
					? error.message
					: 'git worktree add threw unexpectedly.',
		};
	}
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
 * Falls back to an existing `origin/<base>` tracking ref when no upstream is set.
 * @param options - Local branch and Git command dependencies.
 * @returns The origin tracking ref, or `null` when none is available.
 */
async function readOriginTrackingRef({
	baseBranch,
	localCommandService,
	repositoryPath,
}: {
	baseBranch: string;
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

	const trackingRef = `${remote}/${baseBranch}`;
	const exists = await runGitSucceeds({
		args: ['show-ref', '--verify', '--quiet', `refs/remotes/${trackingRef}`],
		localCommandService,
		repositoryPath,
	});
	return exists ? trackingRef : null;
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
	repositoryPath,
}: {
	args: string[];
	localCommandService: LocalCommandService;
	repositoryPath: string;
}): Promise<string> {
	try {
		const result = await localCommandService.run({
			args,
			command: 'git',
			cwd: repositoryPath,
			maxOutputBytes: 16 * 1024,
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

/** Force-removes a worktree registration so a follow-up branch delete succeeds. */
export async function runWorktreeRemove({
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
			timeoutMs: GIT_WORKTREE_TIMEOUT_MS,
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
