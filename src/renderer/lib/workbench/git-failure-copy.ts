import { i18n } from '@/renderer/lib/i18n';
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
			message: i18n.t(
				'workbench:git-failure.not-a-repo.message',
				'This folder is not tracked by git, so there is no history to compare against. Initialize a repository here, or recreate the workspace from a cloned one.',
			),
			title: i18n.t(
				'workbench:git-failure.not-a-repo.title',
				'Not a git repository',
			),
		};
	}
	if (failure.code === 'invalid-cwd') {
		return {
			detail: failure.message,
			message: i18n.t(
				'workbench:git-failure.invalid-cwd.message',
				'The folder this workspace points at could not be opened. It may have been moved, renamed, or deleted since the workspace was created.',
			),
			title: i18n.t(
				'workbench:git-failure.invalid-cwd.title',
				'Workspace folder unavailable',
			),
		};
	}
	return {
		detail: failure.message,
		message: i18n.t(
			'workbench:git-failure.unknown.message',
			'Git could not report this workspace’s changes.',
		),
		title: i18n.t(
			'workbench:git-failure.unknown.title',
			'Could not read changes',
		),
	};
}

/**
 * Panel copy for a trial merge that could not run. Worth showing rather than
 * swallowing, because the probe reports no conflicting paths both when the
 * branch merges cleanly and when it never got to find out.
 * @param failure - The typed failure reported by the workspace git service.
 * @returns Title and the raw git message to show underneath.
 */
export function describeMergeConflictProbeFailure(
	failure: WorkspaceGitFailure,
): Omit<GitFailureCopy, 'message'> {
	return {
		detail: failure.message,
		title: i18n.t(
			'workbench:git-failure.merge-probe.title',
			'Could not check for merge conflicts',
		),
	};
}
