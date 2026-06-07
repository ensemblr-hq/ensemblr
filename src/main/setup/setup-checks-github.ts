import type {
	SetupCheckLogSnapshot,
	SetupCheckSnapshot,
} from '../../shared/ipc';
import type {
	LocalCommandResult,
	LocalCommandService,
} from '../commands/local-command';
import {
	createSetupCheckSnapshot,
	type SetupCheckProviderContext,
} from './setup-diagnostics.ts';

const GITHUB_HOSTNAME = 'github.com';
const GIT_VERSION_TIMEOUT_MS = 3000;
const GITHUB_CLI_TIMEOUT_MS = 3000;
const GITHUB_AUTH_TIMEOUT_MS = 5000;

/** Builds the snapshot for the `git --version` setup check. */
export async function getGitExecutableCheck({
	context,
	localCommandService,
}: {
	context: SetupCheckProviderContext;
	localCommandService: LocalCommandService;
}): Promise<SetupCheckSnapshot> {
	try {
		const result = await localCommandService.run({
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

			return createSetupCheckSnapshot({
				blocking: true,
				description:
					'Detects a runnable git executable before repository and worktree workflows are enabled.',
				detail: `Git is available: ${version}.`,
				group: 'github',
				id: 'git-executable',
				logs,
				remediationActions: [
					{
						id: 'retry-git-executable',
						kind: 'retry',
						label: 'Retry git check',
					},
				],
				status: 'success',
				title: 'Git executable',
				updatedAt: context.now().toISOString(),
			});
		}

		return createSetupCheckSnapshot({
			blocking: true,
			description:
				'Detects a runnable git executable before repository and worktree workflows are enabled.',
			detail: getGitFailureDetail(result),
			group: 'github',
			id: 'git-executable',
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
			title: 'Git executable',
			updatedAt: context.now().toISOString(),
		});
	} catch (error) {
		return createSetupCheckSnapshot({
			blocking: true,
			description:
				'Detects a runnable git executable before repository and worktree workflows are enabled.',
			detail:
				error instanceof Error ? error.message : 'Unknown git check error.',
			group: 'github',
			id: 'git-executable',
			logs: [],
			status: 'failure',
			title: 'Git executable',
			updatedAt: context.now().toISOString(),
		});
	}
}

/** Builds the snapshot for the `gh --version` setup check. */
export async function getGitHubCliCheck({
	context,
	localCommandService,
}: {
	context: SetupCheckProviderContext;
	localCommandService: LocalCommandService;
}): Promise<SetupCheckSnapshot> {
	try {
		const result = await localCommandService.run({
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

			return createSetupCheckSnapshot({
				blocking: true,
				description:
					'Detects a runnable GitHub CLI executable for PR, check, comment, and merge workflows.',
				detail: `GitHub CLI is available: ${version}.`,
				group: 'github',
				id: 'gh-cli',
				logs,
				remediationActions: [
					{
						id: 'retry-gh-cli',
						kind: 'retry',
						label: 'Retry gh check',
					},
				],
				status: 'success',
				title: 'GitHub CLI installed',
				updatedAt: context.now().toISOString(),
			});
		}

		return createSetupCheckSnapshot({
			blocking: true,
			description:
				'Detects a runnable GitHub CLI executable for PR, check, comment, and merge workflows.',
			detail: getGitHubCliFailureDetail(result),
			group: 'github',
			id: 'gh-cli',
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
			title: 'GitHub CLI installed',
			updatedAt: context.now().toISOString(),
		});
	} catch (error) {
		return createSetupCheckSnapshot({
			blocking: true,
			description:
				'Detects a runnable GitHub CLI executable for PR, check, comment, and merge workflows.',
			detail:
				error instanceof Error
					? error.message
					: 'Unknown GitHub CLI check error.',
			group: 'github',
			id: 'gh-cli',
			logs: [],
			status: 'failure',
			title: 'GitHub CLI installed',
			updatedAt: context.now().toISOString(),
		});
	}
}

/** Builds the snapshot for the `gh auth status` setup check. */
export async function getGitHubAuthCheck({
	context,
	localCommandService,
}: {
	context: SetupCheckProviderContext;
	localCommandService: LocalCommandService;
}): Promise<SetupCheckSnapshot> {
	try {
		const result = await localCommandService.run({
			args: ['auth', 'status', '--hostname', GITHUB_HOSTNAME, '--active'],
			command: 'gh',
			maxOutputBytes: 8192,
			timeoutMs: GITHUB_AUTH_TIMEOUT_MS,
		});
		const logs = createCommandLogs(result);

		if (result.status === 'success') {
			return createSetupCheckSnapshot({
				blocking: true,
				description:
					'Runs gh auth status for github.com without requesting token output.',
				detail: `GitHub CLI is authenticated for ${GITHUB_HOSTNAME}.`,
				group: 'github',
				id: 'gh-auth',
				logs,
				remediationActions: [
					{
						id: 'retry-gh-auth',
						kind: 'retry',
						label: 'Retry GitHub auth check',
					},
				],
				status: 'success',
				title: 'GitHub CLI authenticated',
				updatedAt: context.now().toISOString(),
			});
		}

		return createSetupCheckSnapshot({
			blocking: true,
			description:
				'Runs gh auth status for github.com without requesting token output.',
			detail: getGitHubAuthFailureDetail(result),
			group: 'github',
			id: 'gh-auth',
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
			title: 'GitHub CLI authenticated',
			updatedAt: context.now().toISOString(),
		});
	} catch (error) {
		return createSetupCheckSnapshot({
			blocking: true,
			description:
				'Runs gh auth status for github.com without requesting token output.',
			detail:
				error instanceof Error
					? error.message
					: 'Unknown GitHub auth check error.',
			group: 'github',
			id: 'gh-auth',
			logs: [],
			status: 'failure',
			title: 'GitHub CLI authenticated',
			updatedAt: context.now().toISOString(),
		});
	}
}

/** Renders a {@link LocalCommandResult} as a setup check log set. */
function createCommandLogs(
	result: LocalCommandResult,
): SetupCheckLogSnapshot[] {
	const logs: SetupCheckLogSnapshot[] = [
		{
			label: 'Command',
			text: result.logs.command,
		},
	];

	if (result.logs.stdout) {
		logs.push({
			label: 'stdout',
			text: result.logs.stdout,
			truncated: result.stdoutTruncated,
		});
	}

	if (result.logs.stderr) {
		logs.push({
			label: 'stderr',
			text: result.logs.stderr,
			truncated: result.stderrTruncated,
		});
	}

	if (result.failure) {
		logs.push({
			label: result.failure.code,
			text: result.failure.message,
		});
	}

	return logs;
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
