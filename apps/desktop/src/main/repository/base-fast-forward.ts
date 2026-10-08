/**
 * Fast-forwards the local copy of a base branch to its upstream, so a pull
 * request merged on GitHub also lands in the user's own checkout (ADR 0086).
 *
 * Only a fast-forward ever happens. A branch carrying commits of its own is
 * reported as diverged and left alone, and git itself refuses a checkout move
 * that would overwrite a local edit, the same way `git pull --ff-only` does. A
 * branch checked out in a worktree other than the repository's own root — an
 * Ensemblr workspace, say — is never moved, because its files would change under
 * whoever is working there.
 */

import type { LocalBaseSyncOutcome } from '../../shared/workspace-merge.ts';
import type { LocalCommandService } from '../commands/local-command';
import {
	extractGitError,
	fetchRemoteRef,
	readOriginTrackingRef,
	readUpstreamRef,
	resolveConfiguredRemoteRef,
	runGitSucceeds,
	runGitText,
} from './git-ops.ts';
import { canonicalPath } from './managed-path.ts';
import { validateGitRef } from './validate-git-ref.ts';

/**
 * Moving a checked-out branch rewrites the files of the whole checkout, which on
 * a large tree takes far longer than git's metadata queries.
 */
const GIT_FAST_FORWARD_TIMEOUT_MS = 120_000;
const GIT_FAST_FORWARD_MAX_OUTPUT_BYTES = 64 * 1024;
const WORKTREE_LIST_MAX_OUTPUT_BYTES = 512 * 1024;
const REFLOG_MESSAGE = 'ensemblr: fast-forward after pull request merge';
const WORKTREE_LINE_PREFIX = 'worktree ';
const BRANCH_LINE_PREFIX = 'branch ';

/** What every step needs: the repository, the branch, and the command runner. */
interface BranchContext {
	branch: string;
	localCommandService: LocalCommandService;
	repositoryPath: string;
}

/** A branch whose upstream has moved ahead of it, with both commits pinned. */
interface PendingFastForward extends BranchContext {
	from: string;
	to: string;
}

/**
 * Fast-forwards the local branch behind a workspace's base to its upstream.
 * @param options - The workspace's stored base, its repository root, and the command runner.
 * @returns What became of the local branch.
 */
export async function fastForwardLocalBase({
	baseBranch,
	localCommandService,
	repositoryPath,
}: {
	baseBranch: string;
	localCommandService: LocalCommandService;
	repositoryPath: string;
}): Promise<LocalBaseSyncOutcome> {
	const branch = await localBranchFor({
		baseBranch,
		localCommandService,
		repositoryPath,
	});
	if (validateGitRef(branch) !== null || branch.startsWith('-')) {
		return {
			detail: `Base branch "${baseBranch}" is not a usable branch name.`,
			status: 'unavailable',
		};
	}
	const context: BranchContext = {
		branch,
		localCommandService,
		repositoryPath,
	};
	if (!(await commitOf(context, `refs/heads/${branch}`))) {
		return { branch, status: 'no-local-branch' };
	}
	const upstreamRef = await upstreamFor(context);
	if (!upstreamRef) {
		return { branch, status: 'no-upstream' };
	}
	if (!(await fetchUpstream(context, upstreamRef))) {
		return { branch, status: 'fetch-failed', upstreamRef };
	}
	return fastForwardTo(context, upstreamRef);
}

/**
 * Compares the branch with its freshly fetched upstream and moves it when the
 * upstream is strictly ahead.
 * @param context - The branch to move.
 * @param upstreamRef - The fetched upstream it follows.
 * @returns What became of the branch.
 */
async function fastForwardTo(
	context: BranchContext,
	upstreamRef: string,
): Promise<LocalBaseSyncOutcome> {
	const { branch } = context;
	const from = await commitOf(context, `refs/heads/${branch}`);
	const to = await commitOf(context, `${upstreamRef}^{commit}`);
	if (!from || !to) {
		return {
			detail: `Could not resolve ${branch} or ${upstreamRef} to a commit.`,
			status: 'unavailable',
		};
	}
	if (from === to) {
		return { branch, status: 'up-to-date' };
	}
	const isFastForward = await runGitSucceeds({
		args: ['merge-base', '--is-ancestor', from, to],
		localCommandService: context.localCommandService,
		repositoryPath: context.repositoryPath,
	});
	if (!isFastForward) {
		return { branch, status: 'diverged', upstreamRef };
	}
	return moveBranch({ ...context, from, to });
}

/**
 * Moves the branch by whichever means leaves every checkout consistent: the ref
 * alone when nothing has it checked out, a fast-forward merge inside the
 * repository root when that is where it is checked out, and not at all when
 * another worktree holds it.
 * @param pending - The branch and the two commits it moves between.
 * @returns What became of the branch.
 */
async function moveBranch(
	pending: PendingFastForward,
): Promise<LocalBaseSyncOutcome> {
	const checkout = await findCheckout(pending);
	if (checkout.status === 'unknown') {
		return {
			detail: `Could not list the worktrees of ${pending.repositoryPath}.`,
			status: 'unavailable',
		};
	}
	if (checkout.status === 'nowhere') {
		return runMove(pending, pending.repositoryPath, [
			'update-ref',
			'-m',
			REFLOG_MESSAGE,
			`refs/heads/${pending.branch}`,
			pending.to,
			pending.from,
		]);
	}
	if (canonicalPath(checkout.path) !== canonicalPath(pending.repositoryPath)) {
		return {
			branch: pending.branch,
			status: 'checked-out-elsewhere',
			worktreePath: checkout.path,
		};
	}
	return runMove(pending, checkout.path, ['merge', '--ff-only', pending.to]);
}

/**
 * Runs the git command that moves the branch and reports the move, or git's
 * own reason for refusing it.
 * @param pending - The branch and the two commits it moves between.
 * @param cwd - Where to run the command.
 * @param args - The `update-ref` or `merge --ff-only` argv.
 * @returns A fast-forward, or a block carrying git's error line.
 */
async function runMove(
	pending: PendingFastForward,
	cwd: string,
	args: string[],
): Promise<LocalBaseSyncOutcome> {
	const { branch, from, to } = pending;
	try {
		const result = await pending.localCommandService.run({
			args,
			command: 'git',
			cwd,
			maxOutputBytes: GIT_FAST_FORWARD_MAX_OUTPUT_BYTES,
			timeoutMs: GIT_FAST_FORWARD_TIMEOUT_MS,
		});
		if (result.status === 'success') {
			return { branch, from, status: 'fast-forwarded', to };
		}
		return {
			branch,
			detail:
				extractGitError(result.stderr) ||
				result.failure?.message ||
				`git ${args[0]} failed.`,
			status: 'blocked',
		};
	} catch (cause) {
		return {
			branch,
			detail: cause instanceof Error ? cause.message : String(cause),
			status: 'blocked',
		};
	}
}

/**
 * Names the local branch a stored base stands for: `origin/master` is `master`
 * when `origin` is a configured remote, and a bare name is itself.
 * @param options - The stored base, the repository, and the command runner.
 * @returns The local branch name.
 */
async function localBranchFor({
	baseBranch,
	localCommandService,
	repositoryPath,
}: {
	baseBranch: string;
	localCommandService: LocalCommandService;
	repositoryPath: string;
}): Promise<string> {
	const remoteRef = await resolveConfiguredRemoteRef({
		baseBranch,
		localCommandService,
		repositoryPath,
	});
	return remoteRef?.branch ?? baseBranch;
}

/**
 * Reads what the branch follows: its configured upstream, or `origin/<branch>`
 * when none is configured.
 * @param context - The branch whose upstream to read.
 * @returns The upstream ref, or null when it follows nothing.
 */
async function upstreamFor(context: BranchContext): Promise<string | null> {
	const { branch, localCommandService, repositoryPath } = context;
	return (
		(await readUpstreamRef({
			baseBranch: branch,
			localCommandService,
			repositoryPath,
		})) ??
		(await readOriginTrackingRef({
			branch,
			localCommandService,
			repositoryPath,
		}))
	);
}

/**
 * Fetches the upstream when it lives on a remote. An upstream that is another
 * local branch has nothing to fetch, and one whose branch name `git fetch`
 * would read as a flag is refused.
 * @param context - The repository and command runner.
 * @param upstreamRef - The upstream to refresh.
 * @returns False only when a remote fetch failed.
 */
async function fetchUpstream(
	context: BranchContext,
	upstreamRef: string,
): Promise<boolean> {
	const remoteRef = await resolveConfiguredRemoteRef({
		baseBranch: upstreamRef,
		localCommandService: context.localCommandService,
		repositoryPath: context.repositoryPath,
	});
	if (remoteRef?.branch.startsWith('-')) {
		return false;
	}
	return remoteRef
		? fetchRemoteRef({
				localCommandService: context.localCommandService,
				remoteRef,
				repositoryPath: context.repositoryPath,
			})
		: true;
}

/**
 * Resolves a ref to its commit.
 * @param context - The repository and command runner.
 * @param ref - The ref to resolve.
 * @returns The commit id, or an empty string when the ref does not resolve.
 */
function commitOf(context: BranchContext, ref: string): Promise<string> {
	return runGitText({
		args: ['rev-parse', '--verify', '--quiet', ref],
		localCommandService: context.localCommandService,
		repositoryPath: context.repositoryPath,
	});
}

/** Where a branch is checked out, if anywhere. */
type BranchCheckout =
	| { path: string; status: 'checked-out' }
	| { status: 'nowhere' }
	| { status: 'unknown' };

/**
 * Finds the worktree that has the branch checked out. Fails closed: when git
 * cannot list the worktrees the branch reads as possibly checked out, since
 * moving the ref beneath a checkout would desynchronize its index.
 * @param context - The branch to look for.
 * @returns Its checkout, `nowhere`, or `unknown`.
 */
async function findCheckout(context: BranchContext): Promise<BranchCheckout> {
	const listing = await runGitText({
		args: ['worktree', 'list', '--porcelain'],
		localCommandService: context.localCommandService,
		maxOutputBytes: WORKTREE_LIST_MAX_OUTPUT_BYTES,
		repositoryPath: context.repositoryPath,
	});
	if (!listing) {
		return { status: 'unknown' };
	}
	const branchLine = `${BRANCH_LINE_PREFIX}refs/heads/${context.branch}`;
	const holder = listing
		.split(/\r?\n\r?\n/)
		.map((block) => block.split(/\r?\n/))
		.find((lines) => lines.includes(branchLine));
	if (!holder) {
		return { status: 'nowhere' };
	}
	const worktreeLine = holder.find((line) =>
		line.startsWith(WORKTREE_LINE_PREFIX),
	);
	return worktreeLine
		? {
				path: worktreeLine.slice(WORKTREE_LINE_PREFIX.length),
				status: 'checked-out',
			}
		: { status: 'unknown' };
}
