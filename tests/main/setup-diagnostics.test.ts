import assert from 'node:assert/strict';
import test from 'node:test';
import type {
	LocalCommandFailureCode,
	LocalCommandResult,
	LocalCommandService,
} from '../../src/main/commands/local-command.ts';
import type { EnsembleConfigService } from '../../src/main/config/config-loader.ts';
import type { EnvironmentVariablesService } from '../../src/main/environment/environment-variables.ts';
import type { LinearAuthService } from '../../src/main/linear/linear-auth-service.ts';
import type {
	PiExecutableService,
	PiExecutableSnapshot,
} from '../../src/main/pi-runtime/pi-executable.ts';
import type {
	PiReadinessService,
	PiReadinessSnapshot,
} from '../../src/main/pi-runtime/pi-readiness.ts';
import type { EnsembleRootDirectoryService } from '../../src/main/root/root-directory-service.ts';
import {
	createSetupCheckSnapshot,
	type SetupCheckProvider,
} from '../../src/main/setup/setup-check-context.ts';
import { createSetupDiagnosticsService } from '../../src/main/setup/setup-diagnostics.ts';
import type {
	DatabaseHealthSnapshot,
	EnsembleDatabaseService,
} from '../../src/main/storage/database.ts';
import type {
	ConfigStatusSnapshot,
	RootDirectorySnapshot,
	SetupCheckGroupId,
	SetupCheckId,
	SetupCheckSnapshot,
	SetupDiagnosticsSnapshot,
} from '../../src/shared/ipc/index.ts';

const NOW = new Date('2026-06-05T00:00:00.000Z');
const HOME = '/Users/alice';
const CHECK_ORDER: readonly SetupCheckId[] = [
	'config',
	'sqlite-database',
	'root-directory',
	'managed-directories',
	'shell-process-launch',
	'environment-variables',
	'git-executable',
	'gh-cli',
	'gh-auth',
	'pi-executable',
	'pi-agent-directory',
	'pi-rpc',
	'pi-provider-model',
	'linear-oauth',
];
const GROUPS: Record<SetupCheckId, SetupCheckGroupId> = {
	config: 'core',
	'environment-variables': 'core',
	'gh-auth': 'github',
	'gh-cli': 'github',
	'git-executable': 'github',
	'linear-oauth': 'linear',
	'managed-directories': 'storage',
	'pi-agent-directory': 'pi',
	'pi-executable': 'pi',
	'pi-provider-model': 'pi',
	'pi-rpc': 'pi',
	'root-directory': 'storage',
	'shell-process-launch': 'core',
	'sqlite-database': 'storage',
};

interface FakeCommandOutcome {
	exitCode?: number | null;
	failureCode?: LocalCommandFailureCode;
	failureMessage?: string;
	status?: LocalCommandResult['status'];
	stderr?: string;
	stderrTruncated?: boolean;
	stdout?: string;
	stdoutTruncated?: boolean;
}

function createConfigService(
	snapshot: Partial<ConfigStatusSnapshot> = {},
): EnsembleConfigService {
	const configSnapshot: ConfigStatusSnapshot = {
		blocksReadiness: false,
		diagnostics: [],
		displayPath: '~/.config/ensemble/config.json',
		loadedAt: NOW.toISOString(),
		path: `${HOME}/.config/ensemble/config.json`,
		schemaVersion: 1,
		status: 'ok',
		...snapshot,
	};

	return {
		getConfig: () => ({
			app: {},
			environment: {},
			managed: {},
			repositoryDefaults: {},
			repositoryRules: [],
			schemaVersion: 1,
			security: {},
			ui: {},
		}),
		getSnapshot: () => configSnapshot,
		load: () => configSnapshot,
	};
}

function createDatabaseService(
	health: Partial<DatabaseHealthSnapshot> = {},
): EnsembleDatabaseService {
	const snapshot: DatabaseHealthSnapshot = {
		path: `${HOME}/Library/Application Support/com.ensemble.app/ensemble.db`,
		schemaVersion: 3,
		status: 'ok',
		...health,
	};

	return {
		close: () => undefined,
		getConnection: () => null,
		getHealth: () => snapshot,
		open: () => snapshot,
	};
}

function createRootDirectoryService(
	snapshot: Partial<RootDirectorySnapshot> = {},
): EnsembleRootDirectoryService {
	const rootSnapshot: RootDirectorySnapshot = {
		archivedContextsPath: `${HOME}/Ensemble/archived-contexts`,
		createdPaths: [],
		diagnostics: [],
		managedPaths: [
			{
				key: 'repos',
				path: `${HOME}/Ensemble/repos`,
				status: 'present',
			},
			{
				key: 'workspaces',
				path: `${HOME}/Ensemble/workspaces`,
				status: 'present',
			},
			{
				key: 'archived-contexts',
				path: `${HOME}/Ensemble/archived-contexts`,
				status: 'present',
			},
		],
		path: `${HOME}/Ensemble`,
		repositoriesPath: `${HOME}/Ensemble/repos`,
		setting: null,
		source: 'built-in-default',
		status: 'ok',
		workspacesPath: `${HOME}/Ensemble/workspaces`,
		...snapshot,
	};

	return {
		applyChange: () => ({
			applied: true,
			newRoot: rootSnapshot,
			oldRoot: rootSnapshot,
			oldRootPreserved: true,
			reconciliation: {
				diagnostics: [],
				repositoryDirectoryCount: 0,
				scannedAt: NOW.toISOString(),
				status: 'ok',
				workspaceDirectoryCount: 0,
			},
		}),
		ensure: () => rootSnapshot,
		getSnapshot: () => rootSnapshot,
		previewChange: () => ({
			canApply: true,
			diagnostics: [],
			newRoot: rootSnapshot,
			oldRoot: rootSnapshot,
			oldRootPreserved: true,
		}),
	};
}

function createLocalCommandService(
	options: {
		commandResults?: Record<string, FakeCommandOutcome>;
		environmentDiagnostics?: {
			code: string;
			message: string;
			severity: 'warning';
		}[];
		source?: 'fallback' | 'shell';
		stdout?: string;
	} = {},
): LocalCommandService {
	return {
		getEnvironment: async () => ({
			diagnostics: options.environmentDiagnostics ?? [],
			env: {
				PATH: '/bin:/usr/bin',
			},
			path: '/bin:/usr/bin',
			resolvedAt: NOW.toISOString(),
			shell: '/bin/sh',
			source: options.source ?? 'shell',
		}),
		run: async (request) => {
			const args = Array.from(request.args ?? []);
			const outcome =
				options.commandResults?.[formatCommandKey(request.command, args)] ??
				createDefaultCommandOutcome(request.command, args, options.stdout);

			return createLocalCommandResult(request.command, args, outcome);
		},
	};
}

function createEnvironmentVariablesService(): EnvironmentVariablesService {
	return {
		assembleEnvironment: async () => ({
			diagnostics: [],
			env: {},
			redactValues: [],
		}),
		getSnapshot: async () => ({
			catalog: [],
			diagnostics: [],
			generatedAt: NOW.toISOString(),
			missingRequiredCount: 0,
			requiredCount: 0,
			variables: [],
		}),
		setPlainValue: () => {
			throw new Error('setPlainValue is not used by setup diagnostics tests.');
		},
		setSecretValue: async () => {
			throw new Error('setSecretValue is not used by setup diagnostics tests.');
		},
		unsetValue: async () => undefined,
	};
}

function createDefaultCommandOutcome(
	command: string,
	args: string[],
	shellStdout = 'ensemble-process-ok',
): FakeCommandOutcome {
	const argsKey = args.join('\u0000');

	if (
		command === '/bin/sh' &&
		argsKey === '-lc\u0000printf ensemble-process-ok'
	) {
		return {
			stdout: shellStdout,
		};
	}

	if (command === 'git' && argsKey === '--version') {
		return {
			stdout: 'git version 2.45.1',
		};
	}

	if (command === 'gh' && argsKey === '--version') {
		return {
			stdout: 'gh version 2.52.0 (2026-05-01)\nhttps://github.com/cli/cli',
		};
	}

	if (
		command === 'gh' &&
		argsKey === 'auth\u0000status\u0000--hostname\u0000github.com\u0000--active'
	) {
		return {
			stdout: 'github.com\n  ✓ Logged in to github.com account alice (keyring)',
		};
	}

	return {
		exitCode: null,
		failureCode: 'command-not-found',
		failureMessage: `Command not found: ${command}.`,
		status: 'failure',
	};
}

function createLocalCommandResult(
	command: string,
	args: string[],
	outcome: FakeCommandOutcome,
): LocalCommandResult {
	const status = outcome.status ?? 'success';
	const exitCode =
		outcome.exitCode ??
		(status === 'success'
			? 0
			: outcome.failureCode === 'command-not-found'
				? null
				: 1);
	const failure =
		status === 'success'
			? undefined
			: {
					code: outcome.failureCode ?? 'nonzero-exit',
					exitCode,
					message:
						outcome.failureMessage ??
						`Command exited with code ${String(exitCode)}.`,
					signal: null,
				};
	const stdout = outcome.stdout ?? '';
	const stderr = outcome.stderr ?? '';

	return {
		args,
		command,
		cwd: HOME,
		durationMs: 1,
		endedAt: NOW.toISOString(),
		environment: null,
		exitCode,
		failure,
		logs: {
			command: formatCommandKey(command, args),
			cwd: HOME,
			env: {},
			stderr,
			stdout,
		},
		signal: null,
		startedAt: NOW.toISOString(),
		status,
		stderr,
		stderrTruncated: outcome.stderrTruncated ?? false,
		stdout,
		stdoutTruncated: outcome.stdoutTruncated ?? false,
	};
}

function createPiExecutableService(
	snapshot: Partial<PiExecutableSnapshot> = {},
): PiExecutableService {
	const piSnapshot: PiExecutableSnapshot = {
		command: `${HOME}/bin/pi`,
		diagnostics: [],
		displayPath: '~/bin/pi',
		path: `${HOME}/bin/pi`,
		probe: {
			args: ['--version'],
			detail: 'pi version 1.2.3',
			kind: 'version',
			status: 'success',
		},
		setting: null,
		source: 'path',
		status: 'ok',
		updatedAt: NOW.toISOString(),
		...snapshot,
	};

	return {
		getSnapshot: async () => piSnapshot,
		saveOverride: (selectedPath) => ({
			canceled: false,
			selectedPath,
		}),
	};
}

function createPiReadinessService(
	snapshot: Partial<PiReadinessSnapshot> = {},
): PiReadinessService {
	const executable = snapshot.executable ?? {
		command: `${HOME}/bin/pi`,
		diagnostics: [],
		displayPath: '~/bin/pi',
		path: `${HOME}/bin/pi`,
		probe: {
			args: ['--version'],
			detail: 'pi version 1.2.3',
			kind: 'version',
			status: 'success',
		},
		setting: null,
		source: 'path',
		status: 'ok',
		updatedAt: NOW.toISOString(),
	};
	const readinessSnapshot: PiReadinessSnapshot = {
		agentDirectory: {
			diagnostics: [],
			path: `${HOME}/.pi/agent`,
			source: 'default',
			status: 'success',
		},
		executable,
		generatedAt: NOW.toISOString(),
		providerModels: {
			command: executable.command,
			modelCount: 2,
			models: [
				{
					id: 'openai-codex/gpt-5.5',
					model: 'gpt-5.5',
					provider: 'openai-codex',
				},
				{
					id: 'openai-codex/gpt-5.4',
					model: 'gpt-5.4',
					provider: 'openai-codex',
				},
			],
			providerCount: 1,
			result: createLocalCommandResult(executable.command, ['--list-models'], {
				stdout:
					'provider      model       context\nopenai-codex  gpt-5.5     272K\nopenai-codex  gpt-5.4     272K\n',
			}),
			status: 'success',
		},
		rpc: {
			args: ['--mode', 'rpc'],
			command: executable.command,
			cwd: `${HOME}/Ensemble/workspaces/.setup-smoke`,
			durationMs: 2,
			endedAt: NOW.toISOString(),
			firstFrame: {
				type: 'extension_ui_request',
			},
			logs: {
				command: `${executable.command} --mode rpc`,
				cwd: `${HOME}/Ensemble/workspaces/.setup-smoke`,
				stderr: '',
				stdout: '{"type":"extension_ui_request"}\n',
			},
			signal: 'SIGTERM',
			startedAt: NOW.toISOString(),
			status: 'success',
			stderrTruncated: false,
			stdoutTruncated: false,
		},
		...snapshot,
	};

	return {
		getSnapshot: async () => readinessSnapshot,
	};
}

function formatCommandKey(command: string, args: string[]): string {
	return [command, ...args].join(' ');
}

function createProvider(
	id: SetupCheckId,
	status: SetupCheckSnapshot['status'] = 'success',
	blocking = true,
): SetupCheckProvider {
	return () =>
		createSetupCheckSnapshot({
			blocking,
			description: `${id} test provider`,
			detail: `${id} ${status}`,
			group: GROUPS[id],
			id,
			status,
			title: id,
			updatedAt: NOW.toISOString(),
		});
}

function createLinearAuthService(): LinearAuthService {
	const snapshot = {
		expiresAt: null,
		organizationName: null,
		organizationUrlKey: null,
		scopes: [],
		state: 'disconnected',
		updatedAt: null,
		userEmail: null,
		userName: null,
	} as const;

	return {
		cancelLogin: async () => {},
		disconnect: async () => ({ snapshot, status: 'disconnected' }),
		getAccessToken: async () => 'token',
		getConnectionStatus: async () => snapshot,
		startLogin: async () => ({
			failure: { code: 'not-configured', message: 'not configured' },
			status: 'error',
		}),
	};
}

function createFutureProviders(
	overrides: Partial<Record<SetupCheckId, SetupCheckProvider>> = {},
): Partial<Record<SetupCheckId, SetupCheckProvider>> {
	return {
		'linear-oauth': createProvider('linear-oauth', 'warning', false),
		...overrides,
	};
}

async function getSnapshot(
	options: {
		checkProviders?: Partial<Record<SetupCheckId, SetupCheckProvider>>;
		configService?: EnsembleConfigService;
		databaseService?: EnsembleDatabaseService;
		environmentVariablesService?: EnvironmentVariablesService;
		localCommandService?: LocalCommandService;
		piExecutableService?: PiExecutableService;
		piReadinessService?: PiReadinessService;
		rootDirectoryService?: EnsembleRootDirectoryService;
	} = {},
) {
	const service = createSetupDiagnosticsService({
		checkProviders: createFutureProviders(options.checkProviders),
		configService: options.configService ?? createConfigService(),
		databaseService: options.databaseService ?? createDatabaseService(),
		environmentVariablesService:
			options.environmentVariablesService ??
			createEnvironmentVariablesService(),
		homeDirectory: HOME,
		linearAuthService: createLinearAuthService(),
		localCommandService:
			options.localCommandService ?? createLocalCommandService(),
		now: () => NOW,
		piExecutableService:
			options.piExecutableService ?? createPiExecutableService(),
		piReadinessService:
			options.piReadinessService ?? createPiReadinessService(),
		rootDirectoryService:
			options.rootDirectoryService ?? createRootDirectoryService(),
	});

	return service.getSnapshot();
}

function getCheck(
	snapshot: SetupDiagnosticsSnapshot,
	id: SetupCheckId,
): SetupCheckSnapshot {
	const check = snapshot.checks.find((candidate) => candidate.id === id);

	if (!check) {
		assert.fail(`Expected setup check "${id}"`);
	}

	return check;
}

test('reports ready when required checks pass and Linear is optional', async () => {
	const snapshot = await getSnapshot();
	const gitCheck = getCheck(snapshot, 'git-executable');
	const ghCliCheck = getCheck(snapshot, 'gh-cli');
	const ghAuthCheck = getCheck(snapshot, 'gh-auth');
	const piCheck = getCheck(snapshot, 'pi-executable');
	const piAgentDirectoryCheck = getCheck(snapshot, 'pi-agent-directory');
	const piRpcCheck = getCheck(snapshot, 'pi-rpc');
	const piProviderModelCheck = getCheck(snapshot, 'pi-provider-model');
	const environmentVariablesCheck = getCheck(snapshot, 'environment-variables');

	assert.equal(snapshot.status, 'ready');
	assert.equal(snapshot.blockedCount, 0);
	assert.equal(snapshot.optionalCount, 2);
	assert.equal(snapshot.warningCount, 1);
	assert.equal(environmentVariablesCheck.blocking, false);
	assert.equal(environmentVariablesCheck.status, 'success');
	assert.equal(gitCheck.status, 'success');
	assert.match(gitCheck.detail, /git version 2\.45\.1/);
	assert.equal(ghCliCheck.status, 'success');
	assert.match(ghCliCheck.detail, /gh version 2\.52\.0/);
	assert.equal(ghAuthCheck.status, 'success');
	assert.equal(
		ghAuthCheck.detail,
		'GitHub CLI is authenticated for github.com.',
	);
	assert.equal(piCheck.status, 'success');
	assert.match(piCheck.detail, /pi version 1\.2\.3/);
	assert.equal(piAgentDirectoryCheck.status, 'success');
	assert.match(piAgentDirectoryCheck.detail, /~\/\.pi\/agent/);
	assert.equal(piRpcCheck.status, 'success');
	assert.match(piRpcCheck.detail, /valid extension_ui_request frame/);
	assert.equal(piProviderModelCheck.status, 'success');
	assert.match(piProviderModelCheck.detail, /2 models across 1 providers/);
	assert.equal(
		snapshot.checks.find((check) => check.id === 'linear-oauth')?.blocking,
		false,
	);
});

test('blocks readiness when Pi executable discovery fails', async () => {
	const snapshot = await getSnapshot({
		piExecutableService: createPiExecutableService({
			command: '',
			diagnostics: [
				{
					code: 'pi-executable-missing',
					message: 'Configured Pi executable does not exist.',
					severity: 'error',
				},
			],
			displayPath: '',
			path: '',
			probe: null,
			source: 'config-default',
			status: 'error',
		}),
	});
	const piCheck = getCheck(snapshot, 'pi-executable');

	assert.equal(snapshot.status, 'blocked');
	assert.equal(snapshot.blockedCount, 1);
	assert.equal(piCheck.status, 'failure');
	assert.match(piCheck.detail, /Configured Pi executable does not exist/);
	assert.equal(
		piCheck.remediationActions.some(
			(action) =>
				action.kind === 'select-path' && action.target === 'pi.executablePath',
		),
		true,
	);
});

test('does not offer Pi executable picker for locked managed config', async () => {
	const snapshot = await getSnapshot({
		piExecutableService: createPiExecutableService({
			command: '',
			diagnostics: [
				{
					code: 'pi-executable-missing',
					message: 'Managed Pi executable does not exist.',
					severity: 'error',
					source: 'managed-config',
				},
			],
			displayPath: '',
			path: '',
			probe: null,
			setting: {
				candidates: [
					{
						reason: 'Selected by precedence.',
						source: 'managed-config',
						status: 'selected',
					},
				],
				key: 'pi.executablePath',
				locked: true,
				source: 'managed-config',
				value: '/opt/managed/pi',
			},
			source: 'managed-config',
			status: 'error',
		}),
	});
	const piCheck = getCheck(snapshot, 'pi-executable');

	assert.equal(piCheck.status, 'failure');
	assert.equal(
		piCheck.remediationActions.some(
			(action) =>
				action.kind === 'select-path' && action.target === 'pi.executablePath',
		),
		false,
	);
	assert.equal(
		piCheck.remediationActions.some(
			(action) =>
				action.kind === 'retry' && action.id === 'retry-pi-executable',
		),
		true,
	);
});

test('blocks readiness when git is missing', async () => {
	const snapshot = await getSnapshot({
		localCommandService: createLocalCommandService({
			commandResults: {
				'git --version': {
					exitCode: null,
					failureCode: 'command-not-found',
					failureMessage: 'Command not found: git.',
					status: 'failure',
				},
			},
		}),
	});
	const gitCheck = getCheck(snapshot, 'git-executable');

	assert.equal(snapshot.status, 'blocked');
	assert.equal(snapshot.blockedCount, 1);
	assert.equal(gitCheck.status, 'failure');
	assert.match(gitCheck.detail, /Git was not found/);
	assert.equal(
		gitCheck.remediationActions.some(
			(action) => action.command === 'xcode-select --install',
		),
		true,
	);
});

test('blocks readiness when gh is missing', async () => {
	const snapshot = await getSnapshot({
		localCommandService: createLocalCommandService({
			commandResults: {
				'gh --version': {
					exitCode: null,
					failureCode: 'command-not-found',
					failureMessage: 'Command not found: gh.',
					status: 'failure',
				},
			},
		}),
	});
	const ghCliCheck = getCheck(snapshot, 'gh-cli');

	assert.equal(snapshot.status, 'blocked');
	assert.equal(snapshot.blockedCount, 1);
	assert.equal(ghCliCheck.status, 'failure');
	assert.match(ghCliCheck.detail, /GitHub CLI was not found/);
	assert.equal(
		ghCliCheck.remediationActions.some(
			(action) => action.target === 'https://cli.github.com/',
		),
		true,
	);
});

test('blocks readiness when gh auth status is nonzero', async () => {
	const snapshot = await getSnapshot({
		localCommandService: createLocalCommandService({
			commandResults: {
				'gh auth status --hostname github.com --active': {
					exitCode: 1,
					failureCode: 'nonzero-exit',
					failureMessage: 'Command exited with code 1.',
					status: 'failure',
					stderr:
						'You are not logged into any GitHub hosts. Run gh auth login.',
				},
			},
		}),
	});
	const ghAuthCheck = getCheck(snapshot, 'gh-auth');

	assert.equal(snapshot.status, 'blocked');
	assert.equal(snapshot.blockedCount, 1);
	assert.equal(ghAuthCheck.status, 'failure');
	assert.match(ghAuthCheck.detail, /gh auth login --hostname github\.com/);
	assert.equal(
		ghAuthCheck.remediationActions.some(
			(action) => action.command === 'gh auth login --hostname github.com',
		),
		true,
	);
	assert.equal(
		ghAuthCheck.logs.some((log) => log.text.includes('not logged into')),
		true,
	);
});

test('surfaces gh auth status timeouts as blocking failures', async () => {
	const snapshot = await getSnapshot({
		localCommandService: createLocalCommandService({
			commandResults: {
				'gh auth status --hostname github.com --active': {
					exitCode: null,
					failureCode: 'timeout',
					failureMessage: 'The command timed out.',
					status: 'failure',
				},
			},
		}),
	});
	const ghAuthCheck = getCheck(snapshot, 'gh-auth');

	assert.equal(snapshot.status, 'blocked');
	assert.equal(snapshot.blockedCount, 1);
	assert.equal(ghAuthCheck.status, 'failure');
	assert.match(ghAuthCheck.detail, /timed out/);
});

test('does not block readiness for warnings on required checks', async () => {
	const snapshot = await getSnapshot({
		localCommandService: createLocalCommandService({
			environmentDiagnostics: [
				{
					code: 'shell-env-fallback',
					message: 'Shell environment resolution used fallback values.',
					severity: 'warning',
				},
			],
			source: 'fallback',
		}),
	});

	assert.equal(snapshot.status, 'ready');
	assert.equal(
		snapshot.checks.find((check) => check.id === 'shell-process-launch')
			?.status,
		'warning',
	);
});

test('redacts token-like diagnostics from GitHub auth logs', async () => {
	const token = 'ghp_1234567890abcdefghijklmnopQRSTUV';
	const maskedToken = 'gho_************************************';
	const snapshot = await getSnapshot({
		localCommandService: createLocalCommandService({
			commandResults: {
				'gh auth status --hostname github.com --active': {
					exitCode: 1,
					failureCode: 'nonzero-exit',
					failureMessage: 'Command exited with code 1.',
					status: 'failure',
					stderr: `Token: ${token}\nToken: ${maskedToken}\nGITHUB_TOKEN=${token}\n${HOME}/.config/gh/hosts.yml`,
				},
			},
		}),
	});
	const ghAuthCheck = getCheck(snapshot, 'gh-auth');
	const diagnosticText = [
		ghAuthCheck.detail,
		...ghAuthCheck.logs.map((log) => log.text),
	].join('\n');

	assert.equal(diagnosticText.includes(token), false);
	assert.equal(diagnosticText.includes(maskedToken), false);
	assert.equal(diagnosticText.includes('[REDACTED]'), true);
	assert.equal(diagnosticText.includes('~/.config/gh/hosts.yml'), true);
});

test('redacts sensitive log assignments and collapses home paths', async () => {
	const snapshot = await getSnapshot({
		localCommandService: createLocalCommandService({
			stdout: `API_TOKEN=abc123 ${HOME}/Ensemble/workspaces/demo`,
		}),
	});
	const shellCheck = snapshot.checks.find(
		(check) => check.id === 'shell-process-launch',
	);

	assert.ok(shellCheck);
	assert.equal(
		shellCheck.logs.some((log) => log.text.includes('abc123')),
		false,
	);
	assert.equal(
		shellCheck.logs.some((log) =>
			log.text.includes('API_TOKEN=[REDACTED] ~/Ensemble/workspaces/demo'),
		),
		true,
	);
});

test('redacts sensitive Pi provider/model diagnostics', async () => {
	const snapshot = await getSnapshot({
		piReadinessService: createPiReadinessService({
			providerModels: {
				command: `${HOME}/bin/pi`,
				failure: {
					code: 'no-models',
					message:
						'Pi listed zero usable provider models. OPENAI_API_KEY=provider-secret',
				},
				modelCount: 0,
				models: [],
				providerCount: 0,
				result: createLocalCommandResult(`${HOME}/bin/pi`, ['--list-models'], {
					stdout: 'provider      model\nOPENAI_API_KEY=provider-secret\n',
				}),
				status: 'failure',
			},
		}),
	});
	const providerCheck = getCheck(snapshot, 'pi-provider-model');
	const diagnosticText = [
		providerCheck.detail,
		...providerCheck.logs.map((log) => log.text),
	].join('\n');

	assert.equal(diagnosticText.includes('provider-secret'), false);
	assert.equal(diagnosticText.includes('OPENAI_API_KEY=[REDACTED]'), true);
});

test('keeps a stable setup check ordering', async () => {
	const snapshot = await getSnapshot();

	assert.deepEqual(
		snapshot.checks.map((check) => check.id),
		CHECK_ORDER,
	);
});
