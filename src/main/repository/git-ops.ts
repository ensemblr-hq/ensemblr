import type { LocalCommandService } from '../commands/local-command';
import { firstLine } from './first-line.ts';

/** Outcome of a git operation that the caller maps to its own diagnostic code. */
export type GitOpOutcome =
	| { status: 'success' }
	| { status: 'no-branch' }
	| { status: 'failure'; message: string };

/**
 * Outcome of a `git worktree add` that the caller maps to its own diagnostic
 * code. `git-missing` is split from generic failure so callers can surface a
 * tailored install hint.
 */
export type GitWorktreeAddOutcome =
	| { status: 'success' }
	| { status: 'git-missing'; message: string }
	| { status: 'failure'; message: string };

/** Default branch used when a repository has no recorded default. */
export const DEFAULT_FALLBACK_BRANCH = 'main';

const GIT_BRANCH_TIMEOUT_MS = 5_000;
export const GIT_WORKTREE_TIMEOUT_MS = 15_000;

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
