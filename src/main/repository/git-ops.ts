import type { LocalCommandService } from '../commands/local-command';
import { firstLine } from './first-line.ts';

/** Outcome of a git operation that the caller maps to its own diagnostic code. */
export type GitOpOutcome =
	| { status: 'success' }
	| { status: 'no-branch' }
	| { status: 'failure'; message: string };

const GIT_BRANCH_TIMEOUT_MS = 5_000;
const GIT_WORKTREE_TIMEOUT_MS = 15_000;

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
