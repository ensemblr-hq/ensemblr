import type {
	GithubFailure,
	GithubFailureCode,
} from '../../shared/ipc/contracts/github';
import type { LocalCommandResult } from '../commands/local-command';

/**
 * Classifies a failed git/gh command into a stable failure code with a
 * remediation hint. Surfaced verbatim in the UI per ENS-054 ("`gh` failures
 * are shown with remediation and no hidden retry loop").
 */
export function classifyCommandFailure(
	result: LocalCommandResult,
	fallbackMessage: string,
): GithubFailure {
	const stderr = result.stderr.toLowerCase();
	const message =
		result.stderr.trim() || result.failure?.message || fallbackMessage;

	const code = classifyStderr(stderr, result);
	return {
		code,
		message,
		...(remediationFor(code) ? { remediation: remediationFor(code) } : {}),
	};
}

/**
 * Classify a failed `gh` invocation into a coarse failure code from its stderr
 * text and command result.
 * @param stderr - Lowercased stderr output from the gh command
 * @param result - Structured result of the local command run
 * @returns The matched failure code, defaulting to `command-failed`
 */
function classifyStderr(
	stderr: string,
	result: LocalCommandResult,
): GithubFailureCode {
	if (
		result.failure?.code === 'command-not-found' ||
		result.failure?.code === 'spawn-error' ||
		stderr.includes('command not found') ||
		stderr.includes('no such file or directory')
	) {
		return 'gh-not-installed';
	}
	if (
		stderr.includes('gh auth login') ||
		stderr.includes('authentication') ||
		stderr.includes('not logged in') ||
		stderr.includes('bad credentials') ||
		stderr.includes('http 401')
	) {
		return 'gh-not-authenticated';
	}
	if (
		stderr.includes('http 403') ||
		stderr.includes('permission') ||
		stderr.includes('protected branch') ||
		stderr.includes('not authorized')
	) {
		return 'permission-denied';
	}
	if (
		stderr.includes('no pull requests found') ||
		stderr.includes('could not find pull request')
	) {
		return 'no-pull-request';
	}
	if (
		stderr.includes('no remote') ||
		stderr.includes('does not appear to be a git repository') ||
		stderr.includes('could not read from remote repository') ||
		stderr.includes('no upstream')
	) {
		return 'no-remote';
	}
	if (
		stderr.includes('nothing to commit') ||
		stderr.includes('no changes added to commit')
	) {
		return 'nothing-to-commit';
	}
	if (
		stderr.includes('not mergeable') ||
		stderr.includes('merge is blocked') ||
		stderr.includes('required status check') ||
		stderr.includes('review is required')
	) {
		return 'merge-blocked';
	}
	if (
		stderr.includes('uncommitted changes') ||
		stderr.includes('your local changes') ||
		stderr.includes('would be overwritten')
	) {
		return 'dirty-state';
	}
	return 'command-failed';
}

/**
 * Provide a user-facing remediation hint for a GitHub failure code.
 * @param code - The classified failure code
 * @returns A remediation message, or undefined when none applies
 */
function remediationFor(code: GithubFailureCode): string | undefined {
	switch (code) {
		case 'gh-not-installed':
			return 'Install the GitHub CLI (https://cli.github.com) and re-run setup checks.';
		case 'gh-not-authenticated':
			return 'Run `gh auth login` in a terminal, then retry.';
		case 'permission-denied':
			return 'Check your repository permissions or branch protection rules.';
		case 'no-remote':
			return 'Add a GitHub remote to this repository (git remote add origin …).';
		case 'nothing-to-commit':
			return 'Make a change in the workspace before committing.';
		case 'merge-blocked':
			return 'Resolve failing checks or required reviews before merging.';
		case 'dirty-state':
			return 'Commit or stash workspace changes first.';
		default:
			return undefined;
	}
}
