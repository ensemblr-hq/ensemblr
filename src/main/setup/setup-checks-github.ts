import type {
	LocalCommandResult,
	LocalCommandService,
} from '../commands/local-command';
import {
	createCommandLogs,
	defineCheck,
	type SetupCheckProviderContext,
} from './setup-check-context.ts';

const GITHUB_HOSTNAME = 'github.com';
const GIT_VERSION_TIMEOUT_MS = 3000;
const GITHUB_CLI_TIMEOUT_MS = 3000;
const GITHUB_AUTH_TIMEOUT_MS = 5000;

/** Dependencies shared by the GitHub setup checks. */
interface GitHubCheckDeps {
	context: SetupCheckProviderContext;
	localCommandService: LocalCommandService;
}

/** Builds the snapshot for the `git --version` setup check. */
export function getGitExecutableCheck(deps: GitHubCheckDeps) {
	const check = defineCheck<SetupCheckProviderContext>({
		blocking: true,
		description:
			'Detects a runnable git executable before repository and worktree workflows are enabled.',
		group: 'github',
		id: 'git-executable',
		onError: (error) => ({
			detail:
				error instanceof Error ? error.message : 'Unknown git check error.',
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
				const version =
					getFirstOutputLine(result.stdout) ??
					getFirstOutputLine(result.stderr) ??
					'Git version detected.';

				return {
					detail: `Git is available: ${version}.`,
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
				detail: getGitFailureDetail(result),
				logs,
				remediationActions: [
					{
						command: 'xcode-select --install',
						id: 'install-command-line-tools',
						kind: 'run-command',
						label: 'Install command-line tools',
					},
					{
						id: 'open-git-install',
						kind: 'open-external',
						label: 'Open Git install docs',
						target: 'https://git-scm.com/download/mac',
					},
					{
						id: 'retry-git-executable',
						kind: 'retry',
						label: 'Retry git check',
					},
				],
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
		onError: (error) => ({
			detail:
				error instanceof Error
					? error.message
					: 'Unknown GitHub CLI check error.',
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
				const version =
					getFirstOutputLine(result.stdout) ??
					getFirstOutputLine(result.stderr) ??
					'GitHub CLI version detected.';

				return {
					detail: `GitHub CLI is available: ${version}.`,
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
				detail: getGitHubCliFailureDetail(result),
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
		onError: (error) => ({
			detail:
				error instanceof Error
					? error.message
					: 'Unknown GitHub auth check error.',
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
					detail: `GitHub CLI is authenticated for ${GITHUB_HOSTNAME}.`,
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
				detail: getGitHubAuthFailureDetail(result),
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

/** Returns the first non-blank line in a command output, or `null`. */
function getFirstOutputLine(output: string): string | null {
	const line = output
		.split(/\r?\n/)
		.map((part) => part.trim())
		.find(Boolean);

	return line ?? null;
}

/** Maps a `git --version` failure to a user-facing message. */
function getGitFailureDetail(result: LocalCommandResult): string {
	switch (result.failure?.code) {
		case 'command-not-found':
			return 'Git was not found in the shell-derived PATH. Install Git or Xcode Command Line Tools, then retry.';
		case 'timeout':
			return 'Git version check timed out.';
		case 'output-truncated':
			return 'Git version check produced too much output.';
		default:
			return `Git version check failed: ${
				result.failure?.message ?? 'Unknown command failure.'
			}`;
	}
}

/** Maps a `gh --version` failure to a user-facing message. */
function getGitHubCliFailureDetail(result: LocalCommandResult): string {
	switch (result.failure?.code) {
		case 'command-not-found':
			return 'GitHub CLI was not found in the shell-derived PATH. Install gh, then retry.';
		case 'timeout':
			return 'GitHub CLI version check timed out.';
		case 'output-truncated':
			return 'GitHub CLI version check produced too much output.';
		default:
			return `GitHub CLI version check failed: ${
				result.failure?.message ?? 'Unknown command failure.'
			}`;
	}
}

/** Maps a `gh auth status` failure to a user-facing message. */
function getGitHubAuthFailureDetail(result: LocalCommandResult): string {
	switch (result.failure?.code) {
		case 'command-not-found':
			return 'GitHub CLI was not found before authentication could be checked. Install gh, then retry.';
		case 'timeout':
			return `GitHub authentication check timed out for ${GITHUB_HOSTNAME}.`;
		case 'output-truncated':
			return 'GitHub authentication check produced too much output.';
		default:
			return `GitHub CLI is not authenticated for ${GITHUB_HOSTNAME}. Run gh auth login --hostname ${GITHUB_HOSTNAME}, then retry.`;
	}
}
