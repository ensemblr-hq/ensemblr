import type {
	SetupDetailMessage,
	SetupRemediationAction,
} from '../../shared/ipc/contracts/setup';
import type {
	LocalCommandResult,
	LocalCommandService,
} from '../commands/local-command';
import {
	authoredDetail,
	createCommandLogs,
	defineCheck,
	type SetupCheckProviderContext,
	unexpectedErrorDetail,
} from './setup-check-context.ts';

const GITHUB_HOSTNAME = 'github.com';
const GIT_INSTALL_DOCS_BY_PLATFORM: Partial<Record<NodeJS.Platform, string>> = {
	darwin: 'https://git-scm.com/download/mac',
	linux: 'https://git-scm.com/download/linux',
};
const GIT_INSTALL_DOCS_FALLBACK = 'https://git-scm.com/downloads';
const GIT_VERSION_TIMEOUT_MS = 3000;
const GITHUB_CLI_TIMEOUT_MS = 3000;
const GITHUB_AUTH_TIMEOUT_MS = 5000;

/** Dependencies shared by the GitHub setup checks. */
interface GitHubCheckDeps {
	context: SetupCheckProviderContext;
	localCommandService: LocalCommandService;
}

/** Dependencies for the git check, whose remediation varies by platform. */
interface GitExecutableCheckDeps extends GitHubCheckDeps {
	platform: NodeJS.Platform;
}

/** The detail fields a failure mapper returns. */
type DetailResult = { detail: string; detailMessage?: SetupDetailMessage };

/** Builds the snapshot for the `git --version` setup check. */
export function getGitExecutableCheck(deps: GitExecutableCheckDeps) {
	const check = defineCheck<SetupCheckProviderContext>({
		blocking: true,
		description:
			'Detects a runnable git executable before repository and worktree workflows are enabled.',
		group: 'github',
		id: 'git-executable',
		onError: (error) =>
			unexpectedErrorDetail(error, {
				code: 'git-unknown-error',
				text: 'Unknown git check error.',
			}),
		run: async () => {
			const result = await deps.localCommandService.run({
				args: ['--version'],
				command: 'git',
				maxOutputBytes: 4096,
				timeoutMs: GIT_VERSION_TIMEOUT_MS,
			});
			const logs = createCommandLogs(result);

			if (result.status === 'success') {
				const version = getReportedVersion(result);

				return {
					...(version
						? authoredDetail('git-available', `Git is available: ${version}.`, {
								version,
							})
						: authoredDetail(
								'git-available-unknown-version',
								'Git is available.',
							)),
					logs,
					remediationActions: [
						{
							id: 'retry-git-executable',
							kind: 'retry',
							label: 'Retry git check',
						},
					],
					status: 'success',
				};
			}

			return {
				...getGitFailureDetail(result),
				logs,
				remediationActions: getGitFailureRemediationActions(deps.platform),
				status: 'failure',
			};
		},
		title: 'Git executable',
	});

	return check(deps.context);
}

/** Builds the snapshot for the `gh --version` setup check. */
export function getGitHubCliCheck(deps: GitHubCheckDeps) {
	const check = defineCheck<SetupCheckProviderContext>({
		blocking: true,
		description:
			'Detects a runnable GitHub CLI executable for PR, check, comment, and merge workflows.',
		group: 'github',
		id: 'gh-cli',
		onError: (error) =>
			unexpectedErrorDetail(error, {
				code: 'gh-cli-unknown-error',
				text: 'Unknown GitHub CLI check error.',
			}),
		run: async () => {
			const result = await deps.localCommandService.run({
				args: ['--version'],
				command: 'gh',
				maxOutputBytes: 4096,
				timeoutMs: GITHUB_CLI_TIMEOUT_MS,
			});
			const logs = createCommandLogs(result);

			if (result.status === 'success') {
				const version = getReportedVersion(result);

				return {
					...(version
						? authoredDetail(
								'gh-cli-available',
								`GitHub CLI is available: ${version}.`,
								{ version },
							)
						: authoredDetail(
								'gh-cli-available-unknown-version',
								'GitHub CLI is available.',
							)),
					logs,
					remediationActions: [
						{
							id: 'retry-gh-cli',
							kind: 'retry',
							label: 'Retry gh check',
						},
					],
					status: 'success',
				};
			}

			return {
				...getGitHubCliFailureDetail(result),
				logs,
				remediationActions: [
					{
						id: 'open-gh-install',
						kind: 'open-external',
						label: 'Open GitHub CLI install docs',
						target: 'https://cli.github.com/',
					},
					{
						id: 'retry-gh-cli',
						kind: 'retry',
						label: 'Retry gh check',
					},
				],
				status: 'failure',
			};
		},
		title: 'GitHub CLI installed',
	});

	return check(deps.context);
}

/** Builds the snapshot for the `gh auth status` setup check. */
export function getGitHubAuthCheck(deps: GitHubCheckDeps) {
	const check = defineCheck<SetupCheckProviderContext>({
		blocking: true,
		description:
			'Runs gh auth status for github.com without requesting token output.',
		group: 'github',
		id: 'gh-auth',
		onError: (error) =>
			unexpectedErrorDetail(error, {
				code: 'gh-auth-unknown-error',
				text: 'Unknown GitHub auth check error.',
			}),
		run: async () => {
			const result = await deps.localCommandService.run({
				args: ['auth', 'status', '--hostname', GITHUB_HOSTNAME, '--active'],
				command: 'gh',
				maxOutputBytes: 8192,
				timeoutMs: GITHUB_AUTH_TIMEOUT_MS,
			});
			const logs = createCommandLogs(result);

			if (result.status === 'success') {
				return {
					...authoredDetail(
						'gh-auth-ready',
						`GitHub CLI is authenticated for ${GITHUB_HOSTNAME}.`,
						{ hostname: GITHUB_HOSTNAME },
					),
					logs,
					remediationActions: [
						{
							id: 'retry-gh-auth',
							kind: 'retry',
							label: 'Retry GitHub auth check',
						},
					],
					status: 'success',
				};
			}

			return {
				...getGitHubAuthFailureDetail(result),
				logs,
				remediationActions: [
					{
						command: `gh auth login --hostname ${GITHUB_HOSTNAME}`,
						id: 'run-gh-auth-login',
						kind: 'run-command',
						label: 'Run gh auth login',
					},
					{
						id: 'retry-gh-auth',
						kind: 'retry',
						label: 'Retry GitHub auth check',
					},
				],
				status: 'failure',
			};
		},
		title: 'GitHub CLI authenticated',
	});

	return check(deps.context);
}

/** Returns the version line a `--version` run reported, or `null`. */
function getReportedVersion(result: LocalCommandResult): string | null {
	return (
		getFirstOutputLine(result.stdout) ??
		getFirstOutputLine(result.stderr) ??
		null
	);
}

/** Returns the first non-blank line in a command output, or `null`. */
function getFirstOutputLine(output: string): string | null {
	const line = output
		.split(/\r?\n/)
		.map((part) => part.trim())
		.find(Boolean);

	return line ?? null;
}

/**
 * Builds the remediation actions for a failing git check, keeping only the ones
 * that can resolve it on the running platform.
 * @param platform - Platform the app is running on.
 * @returns The remediation actions to offer alongside the failure.
 */
function getGitFailureRemediationActions(
	platform: NodeJS.Platform,
): SetupRemediationAction[] {
	const openInstallDocs: SetupRemediationAction = {
		id: 'open-git-install',
		kind: 'open-external',
		label: 'Open Git install docs',
		target: GIT_INSTALL_DOCS_BY_PLATFORM[platform] ?? GIT_INSTALL_DOCS_FALLBACK,
	};
	const retry: SetupRemediationAction = {
		id: 'retry-git-executable',
		kind: 'retry',
		label: 'Retry git check',
	};

	if (platform === 'darwin') {
		return [
			{
				command: 'xcode-select --install',
				id: 'install-command-line-tools',
				kind: 'run-command',
				label: 'Install command-line tools',
			},
			openInstallDocs,
			retry,
		];
	}

	return [openInstallDocs, retry];
}

/** Maps a `git --version` failure to a user-facing message. */
function getGitFailureDetail(result: LocalCommandResult): DetailResult {
	switch (result.failure?.code) {
		case 'command-not-found':
			return authoredDetail(
				'git-not-found',
				'Git was not found in the shell-derived PATH. Install Git or Xcode Command Line Tools, then retry.',
			);
		case 'timeout':
			return authoredDetail('git-timeout', 'Git version check timed out.');
		case 'output-truncated':
			return authoredDetail(
				'git-output-truncated',
				'Git version check produced too much output.',
			);
		default:
			return result.failure?.message
				? authoredDetail(
						'git-failed',
						`Git version check failed: ${result.failure.message}`,
						{ message: result.failure.message },
					)
				: authoredDetail(
						'git-failed-unknown',
						'Git version check failed: Unknown command failure.',
					);
	}
}

/** Maps a `gh --version` failure to a user-facing message. */
function getGitHubCliFailureDetail(result: LocalCommandResult): DetailResult {
	switch (result.failure?.code) {
		case 'command-not-found':
			return authoredDetail(
				'gh-cli-not-found',
				'GitHub CLI was not found in the shell-derived PATH. Install gh, then retry.',
			);
		case 'timeout':
			return authoredDetail(
				'gh-cli-timeout',
				'GitHub CLI version check timed out.',
			);
		case 'output-truncated':
			return authoredDetail(
				'gh-cli-output-truncated',
				'GitHub CLI version check produced too much output.',
			);
		default:
			return result.failure?.message
				? authoredDetail(
						'gh-cli-failed',
						`GitHub CLI version check failed: ${result.failure.message}`,
						{ message: result.failure.message },
					)
				: authoredDetail(
						'gh-cli-failed-unknown',
						'GitHub CLI version check failed: Unknown command failure.',
					);
	}
}

/** Maps a `gh auth status` failure to a user-facing message. */
function getGitHubAuthFailureDetail(result: LocalCommandResult): DetailResult {
	switch (result.failure?.code) {
		case 'command-not-found':
			return authoredDetail(
				'gh-auth-cli-not-found',
				'GitHub CLI was not found before authentication could be checked. Install gh, then retry.',
			);
		case 'timeout':
			return authoredDetail(
				'gh-auth-timeout',
				`GitHub authentication check timed out for ${GITHUB_HOSTNAME}.`,
				{ hostname: GITHUB_HOSTNAME },
			);
		case 'output-truncated':
			return authoredDetail(
				'gh-auth-output-truncated',
				'GitHub authentication check produced too much output.',
			);
		default:
			return authoredDetail(
				'gh-auth-required',
				`GitHub CLI is not authenticated for ${GITHUB_HOSTNAME}. Run gh auth login --hostname ${GITHUB_HOSTNAME}, then retry.`,
				{ hostname: GITHUB_HOSTNAME },
			);
	}
}
