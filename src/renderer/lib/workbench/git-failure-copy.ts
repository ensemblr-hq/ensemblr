import { type CodedFailure, failureText } from '@/renderer/lib/failure-text';
import { i18n } from '@/renderer/lib/i18n';
import type { CommandFailureCopy } from '@/renderer/types/workbench';
import type { WorkspaceGitFailure } from '@/shared/ipc/contracts/workspace-git';

/** Panel copy for a failed git read: what happened, what to do, and git's own words. */
export interface GitFailureCopy extends CommandFailureCopy {
	title: string;
}

/**
 * The command's own output, demoted below the explanation — but only when it is
 * genuinely the command's. `message` falls back to prose the main process wrote
 * whenever the command printed nothing to stderr, and that prose is never
 * translated, so demoting it would put an English sentence in a Russian or
 * Greek panel dressed as git's words. `output` is set only from real stderr.
 * @param failure - The coded failure the git or gh service reported.
 * @param message - The translated explanation the output sits beneath.
 * @returns The detail slot, empty when there is nothing worth demoting.
 */
function demotedOutput(
	failure: CodedFailure,
	message: string,
): Pick<CommandFailureCopy, 'detail'> {
	const output = failure.output?.trim();
	return output && output !== message ? { detail: output } : {};
}

/**
 * The copy for a git or gh failure: the explanation in the reader's language,
 * plus the command's own output demoted underneath when it says more than the
 * explanation does.
 * @param failure - The coded failure the git or gh service reported.
 * @returns The translated explanation and the output to show beneath it.
 */
export function describeCommandFailure(
	failure: CodedFailure,
): CommandFailureCopy {
	const message = failureText(i18n.t, failure) ?? failure.message;
	return { ...demotedOutput(failure, message), message };
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
		const message = i18n.t(
			'workbench:git-failure.not-a-repo.message',
			'This folder is not tracked by git, so there is no history to compare against. Initialize a repository here, or recreate the workspace from a cloned one.',
		);
		return {
			...demotedOutput(failure, message),
			message,
			title: i18n.t(
				'workbench:git-failure.not-a-repo.title',
				'Not a git repository',
			),
		};
	}
	if (failure.code === 'invalid-cwd') {
		const message = i18n.t(
			'workbench:git-failure.invalid-cwd.message',
			'The folder this workspace points at could not be opened. It may have been moved, renamed, or deleted since the workspace was created.',
		);
		return {
			...demotedOutput(failure, message),
			message,
			title: i18n.t(
				'workbench:git-failure.invalid-cwd.title',
				'Workspace folder unavailable',
			),
		};
	}
	const message = i18n.t(
		'workbench:git-failure.unknown.message',
		'Git could not report this workspace’s changes.',
	);
	return {
		...demotedOutput(failure, message),
		message,
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
 * @returns Title, translated explanation, and git's own words when they add anything.
 */
export function describeMergeConflictProbeFailure(
	failure: WorkspaceGitFailure,
): GitFailureCopy {
	return {
		...describeCommandFailure(failure),
		title: i18n.t(
			'workbench:git-failure.merge-probe.title',
			'Could not check for merge conflicts',
		),
	};
}
