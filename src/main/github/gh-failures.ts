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
	const remediation = remediationFor(code);
	return {
		code,
		message,
		...(remediation ? { remediation } : {}),
	};
}

/** Stderr substrings that identify a failure code, in match-priority order. */
const STDERR_SIGNATURES: readonly {
	code: GithubFailureCode;
	markers: readonly string[];
}[] = [
	{
		code: 'gh-not-installed',
		markers: ['command not found', 'no such file or directory'],
	},
	{
		code: 'gh-not-authenticated',
		markers: [
			'gh auth login',
			'authentication',
			'not logged in',
			'bad credentials',
			'http 401',
		],
	},
	{
		code: 'permission-denied',
		markers: ['http 403', 'permission', 'protected branch', 'not authorized'],
	},
	{
		code: 'no-pull-request',
		markers: ['no pull requests found', 'could not find pull request'],
	},
	{
		code: 'no-remote',
		markers: [
			'no remote',
			'does not appear to be a git repository',
			'could not read from remote repository',
			'no upstream',
		],
	},
	{
		code: 'nothing-to-commit',
		markers: ['nothing to commit', 'no changes added to commit'],
	},
	{
		code: 'merge-blocked',
		markers: [
			'not mergeable',
			'merge is blocked',
			'required status check',
			'review is required',
		],
	},
	{
		code: 'dirty-state',
		markers: [
			'uncommitted changes',
			'your local changes',
			'would be overwritten',
		],
	},
];

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
		result.failure?.code === 'spawn-error'
	) {
		return 'gh-not-installed';
	}
	const matched = STDERR_SIGNATURES.find(({ markers }) =>
		matchesAnyMarker(stderr, markers),
	);
	return matched?.code ?? 'command-failed';
}

/**
 * Whether any of a signature's markers appears in the stderr text.
 * @param stderr - Lowercased stderr output from the gh command
 * @param markers - Substrings that identify one failure code
 * @returns True when stderr contains at least one marker
 */
function matchesAnyMarker(stderr: string, markers: readonly string[]): boolean {
	// oxlint-disable-next-line react-doctor/js-set-map-lookups -- String.includes is a substring search, not an array membership test, so a Set cannot replace it
	return markers.some((marker) => stderr.includes(marker));
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
