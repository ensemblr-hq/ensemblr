import type { DemoSetupCheck } from '../scenario.ts';

/**
 * The whole setup rollup on a machine where everything resolved, in the order
 * the diagnostics panel groups it: core, storage, GitHub, Pi, Claude Code,
 * Linear.
 *
 * Every detail line carries the `detailMessage` code the check authors rather
 * than English prose, because main returns a locale-neutral code and the
 * renderer maps it — a hand-written sentence here would render untranslated on
 * a translated screen. `blocking` mirrors what each check declares once the
 * either-or agent-runtime gate has resolved, which on a machine carrying both
 * runtimes leaves every flag as declared.
 */
export const HEALTHY_SETUP_CHECKS: readonly DemoSetupCheck[] = [
	{
		blocking: true,
		description:
			'Loads ~/.config/ensemblr/config.json and validates whether config can be trusted before setup continues.',
		detail: 'Declarative config loaded.',
		detailMessage: { code: 'config-loaded' },
		group: 'core',
		id: 'config',
		logs: [],
		remediationActions: [
			{
				id: 'open-config-settings',
				kind: 'open-settings',
				label: 'Open config diagnostics',
				target: 'config',
			},
			{ id: 'retry-config', kind: 'retry', label: 'Retry config check' },
		],
		status: 'success',
		title: 'Declarative config',
	},
	{
		blocking: true,
		description:
			'Verifies Electron can launch local commands through the user shell environment.',
		detail: 'Commands launch successfully with the shell-derived environment.',
		detailMessage: { code: 'shell-ready' },
		group: 'core',
		id: 'shell-process-launch',
		logs: [
			{
				label: 'Command',
				labelMessage: { code: 'command' },
				text: '/bin/zsh -lc printf ensemblr-process-ok',
			},
		],
		remediationActions: [
			{
				id: 'retry-shell-process-launch',
				kind: 'retry',
				label: 'Retry check',
			},
		],
		status: 'success',
		title: 'Shell and process launch',
	},
	{
		blocking: false,
		description:
			'Checks the global environment variable catalog and safe secret metadata without printing values.',
		detail:
			'0 configured variables, 0 masked secrets, and 5 reserved runtime variables are cataloged.',
		detailMessage: {
			code: 'environment-cataloged',
			params: { configured: 0, masked: 0, reserved: 5 },
		},
		group: 'core',
		id: 'environment-variables',
		logs: [
			{
				label: 'Configured variables',
				labelMessage: { code: 'configured-variables' },
				text: '0',
			},
			{
				label: 'Reserved runtime variables',
				labelMessage: { code: 'reserved-runtime-variables' },
				text: '5',
			},
		],
		remediationActions: [
			{
				id: 'open-environment-settings',
				kind: 'open-settings',
				label: 'Open environment settings',
				target: 'environment',
			},
			{
				id: 'retry-environment-variables',
				kind: 'retry',
				label: 'Retry environment check',
			},
		],
		status: 'success',
		title: 'Environment variables',
	},
	{
		blocking: false,
		description:
			'Reports which OS keyring backend encrypts stored secrets, and warns when the session offers none.',
		detail: 'Secrets are encrypted by the macOS Keychain keyring.',
		detailMessage: {
			code: 'secret-storage-encrypted',
			params: { backend: 'macOS Keychain' },
		},
		group: 'core',
		id: 'secret-storage',
		logs: [
			{
				label: 'Keyring backend',
				labelMessage: { code: 'keyring-backend' },
				text: 'macOS Keychain',
			},
		],
		remediationActions: [
			{
				id: 'retry-secret-storage',
				kind: 'retry',
				label: 'Retry secret storage check',
			},
		],
		status: 'success',
		title: 'Secret storage',
	},
	{
		blocking: true,
		description:
			'Opens the local app-support SQLite database and verifies migrations completed.',
		detail:
			'SQLite opened at ~/Library/Application Support/dev.ensemblr.app/ensemblr.db; schema version 16.',
		detailMessage: {
			code: 'database-ready',
			params: {
				path: '~/Library/Application Support/dev.ensemblr.app/ensemblr.db',
				schemaVersion: 16,
			},
		},
		group: 'storage',
		id: 'sqlite-database',
		logs: [
			{
				label: 'Database path',
				labelMessage: { code: 'database-path' },
				text: '~/Library/Application Support/dev.ensemblr.app/ensemblr.db',
			},
		],
		remediationActions: [
			{ id: 'retry-database', kind: 'retry', label: 'Retry database check' },
		],
		status: 'success',
		title: 'SQLite database',
	},
	{
		blocking: true,
		description:
			'Validates the configured Ensemblr root directory before repositories and workspaces are created.',
		detail: 'Ensemblr root is ready at ~/Code.',
		detailMessage: { code: 'root-directory-ready', params: { path: '~/Code' } },
		group: 'storage',
		id: 'root-directory',
		logs: [
			{
				label: 'Root path',
				labelMessage: { code: 'root-path' },
				text: '~/Code',
			},
		],
		remediationActions: [
			{
				id: 'choose-root-directory',
				kind: 'select-path',
				label: 'Choose another root',
				target: 'rootDirectory',
			},
			{
				id: 'retry-root-directory',
				kind: 'retry',
				label: 'Retry root check',
			},
		],
		status: 'success',
		title: 'Root directory',
	},
	{
		blocking: true,
		description:
			'Checks repos, workspaces, and archived-contexts under the selected root.',
		detail:
			'Managed repos, workspaces, and archived-contexts directories are ready.',
		detailMessage: { code: 'managed-directories-ready' },
		group: 'storage',
		id: 'managed-directories',
		logs: [],
		remediationActions: [
			{
				id: 'retry-managed-directories',
				kind: 'retry',
				label: 'Retry managed directories check',
			},
		],
		status: 'success',
		title: 'Managed directories',
	},
	{
		blocking: true,
		description: 'Resolves the git executable used for every repository call.',
		detail: 'Git is available: 2.51.0.',
		detailMessage: { code: 'git-available', params: { version: '2.51.0' } },
		group: 'github',
		id: 'git-executable',
		logs: [
			{
				label: 'Command',
				labelMessage: { code: 'command' },
				text: 'git --version',
			},
		],
		remediationActions: [
			{
				id: 'retry-git-executable',
				kind: 'retry',
				label: 'Retry git check',
			},
		],
		status: 'success',
		title: 'Git executable',
	},
	{
		blocking: true,
		description:
			'Resolves the GitHub CLI that pull-request and review workflows shell out to.',
		detail: 'GitHub CLI is available: 2.83.0.',
		detailMessage: { code: 'gh-cli-available', params: { version: '2.83.0' } },
		group: 'github',
		id: 'gh-cli',
		logs: [
			{
				label: 'Command',
				labelMessage: { code: 'command' },
				text: 'gh --version',
			},
		],
		remediationActions: [
			{ id: 'retry-gh-cli', kind: 'retry', label: 'Retry GitHub CLI check' },
		],
		status: 'success',
		title: 'GitHub CLI installed',
	},
	{
		blocking: true,
		description: 'Confirms the GitHub CLI is signed in for github.com.',
		detail: 'GitHub CLI is authenticated for github.com.',
		detailMessage: {
			code: 'gh-auth-ready',
			params: { hostname: 'github.com' },
		},
		group: 'github',
		id: 'gh-auth',
		logs: [
			{
				label: 'Command',
				labelMessage: { code: 'command' },
				text: 'gh auth status --hostname github.com',
			},
		],
		remediationActions: [
			{ id: 'retry-gh-auth', kind: 'retry', label: 'Retry GitHub auth check' },
		],
		status: 'success',
		title: 'GitHub CLI authenticated',
	},
	{
		blocking: true,
		description: 'Resolves the Pi executable that drives a Pi chat.',
		detail:
			'Pi executable selected from shell PATH: /opt/homebrew/bin/pi. version probe returned: pi 0.14.2',
		detailMessage: {
			code: 'pi-executable-ready-with-probe',
			params: {
				path: '/opt/homebrew/bin/pi',
				probeDetail: 'pi 0.14.2',
				probeKind: 'version',
				source: 'path',
			},
		},
		group: 'pi',
		id: 'pi-executable',
		logs: [
			{
				label: 'Executable path',
				labelMessage: { code: 'executable-path' },
				text: '/opt/homebrew/bin/pi',
			},
		],
		remediationActions: [
			{
				id: 'select-pi-executable',
				kind: 'select-path',
				label: 'Select Pi executable',
			},
			{ id: 'retry-pi-executable', kind: 'retry', label: 'Retry Pi check' },
		],
		status: 'success',
		title: 'Pi executable',
	},
	{
		blocking: true,
		description:
			'Verifies the directory Pi reads its agent definitions and sessions from.',
		detail: 'Pi agent directory resolves from Pi default location: ~/.pi.',
		detailMessage: {
			code: 'pi-agent-directory-ready',
			params: { path: '~/.pi', source: 'default' },
		},
		group: 'pi',
		id: 'pi-agent-directory',
		logs: [
			{
				label: 'Agent directory path',
				labelMessage: { code: 'agent-directory-path' },
				text: '~/.pi',
			},
		],
		remediationActions: [
			{
				id: 'retry-pi-agent-directory',
				kind: 'retry',
				label: 'Retry Pi agent directory check',
			},
		],
		status: 'success',
		title: 'Pi agent directory',
	},
	{
		blocking: true,
		description: 'Starts Pi in RPC mode and reads back its first JSONL frame.',
		detail: 'Pi RPC startup produced a valid session frame from ~/Code.',
		detailMessage: {
			code: 'pi-rpc-ready',
			params: { cwd: '~/Code', frameType: 'session' },
		},
		group: 'pi',
		id: 'pi-rpc',
		logs: [
			{
				label: 'First JSONL frame',
				labelMessage: { code: 'first-jsonl-frame' },
				text: '{"type":"session","protocol":1}',
			},
		],
		remediationActions: [
			{
				id: 'select-pi-executable-for-rpc',
				kind: 'select-path',
				label: 'Select Pi executable',
			},
			{ id: 'retry-pi-rpc', kind: 'retry', label: 'Retry Pi RPC check' },
		],
		status: 'success',
		title: 'Pi RPC startup',
	},
	{
		blocking: true,
		description: 'Lists the providers and models Pi can currently reach.',
		detail: 'Pi listed 18 models across 4 providers.',
		detailMessage: {
			code: 'pi-models-ready',
			params: { modelCount: 18, providerCount: 4 },
		},
		group: 'pi',
		id: 'pi-provider-model',
		logs: [
			{
				label: 'Model count',
				labelMessage: { code: 'model-count' },
				text: '18',
			},
			{
				label: 'Provider count',
				labelMessage: { code: 'provider-count' },
				text: '4',
			},
		],
		remediationActions: [
			{
				id: 'open-pi-provider-settings',
				kind: 'open-settings',
				label: 'Open Pi provider settings',
				target: 'models',
			},
			{
				id: 'retry-pi-provider-model',
				kind: 'retry',
				label: 'Retry Pi model check',
			},
		],
		status: 'success',
		title: 'Pi provider and model readiness',
	},
	{
		blocking: false,
		description:
			'Resolves the Claude Code executable that drives a Claude chat.',
		detail: 'Found on PATH: /opt/homebrew/bin/claude.',
		detailMessage: {
			code: 'claude-executable-on-path',
			params: { path: '/opt/homebrew/bin/claude' },
		},
		group: 'claude',
		id: 'claude-executable',
		logs: [
			{
				label: 'Executable path',
				labelMessage: { code: 'executable-path' },
				text: '/opt/homebrew/bin/claude',
			},
		],
		remediationActions: [
			{
				id: 'select-claude-executable',
				kind: 'select-path',
				label: 'Select Claude Code executable',
			},
			{
				id: 'retry-claude-executable',
				kind: 'retry',
				label: 'Retry Claude Code check',
			},
		],
		status: 'success',
		title: 'Claude Code executable',
	},
	{
		blocking: false,
		description:
			'Reports the Linear OAuth connection used by issue browsing, issue workflows, and workspace creation from issues.',
		detail: 'Linear is connected as Philipp (Ensemblr).',
		detailMessage: {
			code: 'linear-connected-with-organization',
			params: { identity: 'Philipp', organization: 'Ensemblr' },
		},
		group: 'linear',
		id: 'linear-oauth',
		logs: [],
		remediationActions: [
			{
				id: 'open-linear-settings',
				kind: 'open-settings',
				label: 'Open Linear settings',
				target: 'linear',
			},
			{ id: 'retry-linear', kind: 'retry', label: 'Retry Linear check' },
		],
		status: 'success',
		title: 'Linear connection',
	},
];

/**
 * The shell check reporting the one warning a diagnostics shot needs: the smoke
 * test passed but the login shell did not answer, so the environment fell back.
 * Non-blocking in effect — `warning` counts as a pass — which keeps the rollup
 * reading "ready" while one row carries its remediation.
 */
export const SHELL_ENVIRONMENT_FALLBACK: DemoSetupCheck = {
	blocking: true,
	description:
		'Verifies Electron can launch local commands through the user shell environment.',
	detail:
		'Commands launch successfully, but shell environment resolution used a fallback.',
	detailMessage: { code: 'shell-fallback-environment' },
	group: 'core',
	id: 'shell-process-launch',
	logs: [
		{
			label: 'Command',
			labelMessage: { code: 'command' },
			text: '/bin/zsh -lc printf ensemblr-process-ok',
		},
		{
			label: 'shell-resolution-timeout',
			text: 'The login shell did not answer in time; the inherited environment was used instead.',
		},
	],
	remediationActions: [
		{
			id: 'retry-shell-process-launch',
			kind: 'retry',
			label: 'Retry check',
		},
	],
	status: 'warning',
	title: 'Shell and process launch',
};

/**
 * The Pi runtime group on a machine that never installed it. All four checks
 * move together because the onboarding wizard rolls the whole group into one
 * card — a missing binary that left the handshake reading "ready" would be a
 * state no machine can be in.
 */
export const PI_RUNTIME_MISSING: readonly DemoSetupCheck[] = [
	{
		blocking: true,
		description: 'Resolves the Pi executable that drives a Pi chat.',
		detail:
			'Pi executable could not be discovered. Install Pi, select a compatible executable or wrapper, then retry.',
		detailMessage: { code: 'pi-executable-not-found' },
		group: 'pi',
		id: 'pi-executable',
		logs: [],
		remediationActions: [
			{
				id: 'select-pi-executable',
				kind: 'select-path',
				label: 'Select Pi executable',
			},
			{ id: 'retry-pi-executable', kind: 'retry', label: 'Retry Pi check' },
		],
		status: 'failure',
		title: 'Pi executable',
	},
	{
		blocking: true,
		description:
			'Verifies the directory Pi reads its agent definitions and sessions from.',
		detail:
			'Pi agent directory could not be verified. Fix the Pi environment path or directory permissions, then retry.',
		detailMessage: { code: 'pi-agent-directory-unverified' },
		group: 'pi',
		id: 'pi-agent-directory',
		logs: [],
		remediationActions: [
			{
				id: 'retry-pi-agent-directory',
				kind: 'retry',
				label: 'Retry Pi agent directory check',
			},
		],
		status: 'failure',
		title: 'Pi agent directory',
	},
	{
		blocking: true,
		description: 'Starts Pi in RPC mode and reads back its first JSONL frame.',
		detail: 'Pi RPC startup did not produce valid JSONL.',
		detailMessage: { code: 'pi-rpc-invalid' },
		group: 'pi',
		id: 'pi-rpc',
		logs: [],
		remediationActions: [
			{
				id: 'select-pi-executable-for-rpc',
				kind: 'select-path',
				label: 'Select Pi executable',
			},
			{ id: 'retry-pi-rpc', kind: 'retry', label: 'Retry Pi RPC check' },
		],
		status: 'failure',
		title: 'Pi RPC startup',
	},
	{
		blocking: true,
		description: 'Lists the providers and models Pi can currently reach.',
		detail: 'Pi provider/model readiness could not be verified.',
		detailMessage: { code: 'pi-models-unverified' },
		group: 'pi',
		id: 'pi-provider-model',
		logs: [],
		remediationActions: [
			{
				id: 'retry-pi-provider-model',
				kind: 'retry',
				label: 'Retry Pi model check',
			},
		],
		status: 'failure',
		title: 'Pi provider and model readiness',
	},
];

/**
 * The healthy rollup with named checks swapped in for their healthy twins,
 * preserving list order so the panel's grouping is unchanged.
 * @param overrides - Replacement checks, each standing in for the check sharing its id.
 * @returns A new check list with the overrides applied.
 */
export function setupChecksWith(
	...overrides: readonly DemoSetupCheck[]
): readonly DemoSetupCheck[] {
	const byId = new Map(overrides.map((check) => [check.id, check]));

	return HEALTHY_SETUP_CHECKS.map((check) => byId.get(check.id) ?? check);
}
