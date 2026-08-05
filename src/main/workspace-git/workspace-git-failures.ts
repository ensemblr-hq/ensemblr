/**
 * Shared classification of failed `git` invocations. Kept beside the parsers
 * rather than inside the service so every git-backed module reports a failure
 * the same way, and so both stay trivially unit-testable.
 */
import type { WorkspaceGitFailureCode } from '../../shared/ipc/contracts/workspace-git';

/**
 * What git's own exit codes mean, for the rare failure where git exits without
 * writing anything to stderr and the bare number is all we have to show.
 */
const GIT_EXIT_CODE_REASONS: Record<string, string | undefined> = {
	128: 'git reported a fatal error (exit code 128) — usually a missing repository, an unreadable working tree, or an unknown revision.',
	129: 'git rejected its own arguments (exit code 129).',
};

/**
 * Best available reason a git invocation failed. Git puts the real cause on
 * stderr ("fatal: not a git repository"), while the spawn layer only knows the
 * exit code, so stderr wins whenever it said anything at all.
 * @param result - Outcome of the failed git invocation.
 * @param fallback - Copy to use when git wrote nothing to stderr.
 * @returns The most specific failure text available.
 */
export function gitFailureMessage(
	result: {
		failure?: { exitCode: number | null; message: string };
		stderr: string;
	},
	fallback: string,
): string {
	const stderr = result.stderr.trim();
	if (stderr) {
		return stderr;
	}
	const failure = result.failure;
	if (!failure) {
		return fallback;
	}
	return GIT_EXIT_CODE_REASONS[String(failure.exitCode)] ?? failure.message;
}

/**
 * Distinguishes "not a repo" from generic git failures via stderr.
 * @param stderr - Standard error captured from the failed invocation.
 * @returns The failure code the UI branches on.
 */
export function classifyGitFailure(
	stderr: string,
): Extract<WorkspaceGitFailureCode, 'command-failed' | 'not-a-git-repo'> {
	const lowered = stderr.toLowerCase();
	if (
		lowered.includes('not a git repository') ||
		lowered.includes('does not have any git working tree')
	) {
		return 'not-a-git-repo';
	}
	return 'command-failed';
}
