import type { WorkspaceGitFailure } from '@/shared/ipc/contracts/workspace-git';

/** Panel copy for a failed git read: what happened, what to do, and git's own words. */
export interface GitFailureCopy {
	detail: string;
	message: string;
	title: string;
}

/**
 * Turns a typed workspace-git failure into copy a person can act on. Git's raw
 * text stays as supporting detail instead of standing in for the explanation,
 * because on its own it reads as an exit code rather than a problem.
 * @param failure - The typed failure reported by the workspace git service.
 * @returns Title, explanation, and the raw git message to show underneath.
 */
export function describeWorkspaceGitFailure(
	failure: WorkspaceGitFailure,
): GitFailureCopy {
	if (failure.code === 'not-a-git-repo') {
		return {
			detail: failure.message,
			message:
				'This folder is not tracked by git, so there is no history to compare against. Initialize a repository here, or recreate the workspace from a cloned one.',
			title: 'Not a git repository',
		};
	}
	if (failure.code === 'invalid-cwd') {
		return {
			detail: failure.message,
			message:
				'The folder this workspace points at could not be opened. It may have been moved, renamed, or deleted since the workspace was created.',
			title: 'Workspace folder unavailable',
		};
	}
	return {
		detail: failure.message,
		message: 'Git could not report this workspace’s changes.',
		title: 'Could not read changes',
	};
}
