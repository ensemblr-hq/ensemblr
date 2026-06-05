import assert from 'node:assert/strict';
import test from 'node:test';
import type { LocalCommandService } from '../../src/main/commands/local-command.ts';
import type { PiductorConfigService } from '../../src/main/config/config-loader.ts';
import type { PiductorRootDirectoryService } from '../../src/main/root/root-directory.ts';
import {
	createSetupCheckSnapshot,
	createSetupDiagnosticsService,
	type SetupCheckProvider,
} from '../../src/main/setup/setup-diagnostics.ts';
import type {
	DatabaseHealthSnapshot,
	PiductorDatabaseService,
} from '../../src/main/storage/database.ts';
import type {
	ConfigStatusSnapshot,
	RootDirectorySnapshot,
	SetupCheckGroupId,
	SetupCheckId,
	SetupCheckSnapshot,
} from '../../src/shared/ipc.ts';

const NOW = new Date('2026-06-05T00:00:00.000Z');
const HOME = '/Users/alice';
const FUTURE_REQUIRED_CHECKS: readonly SetupCheckId[] = [
	'git-executable',
	'gh-cli',
	'gh-auth',
	'pi-executable',
	'pi-agent-directory',
	'pi-rpc',
	'pi-provider-model',
];
const CHECK_ORDER: readonly SetupCheckId[] = [
	'config',
	'sqlite-database',
	'root-directory',
	'managed-directories',
	'shell-process-launch',
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

function createConfigService(
	snapshot: Partial<ConfigStatusSnapshot> = {},
): PiductorConfigService {
	const configSnapshot: ConfigStatusSnapshot = {
		blocksReadiness: false,
		diagnostics: [],
		displayPath: '~/.config/piductor/config.json',
		loadedAt: NOW.toISOString(),
		path: `${HOME}/.config/piductor/config.json`,
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
): PiductorDatabaseService {
	const snapshot: DatabaseHealthSnapshot = {
		path: `${HOME}/Library/Application Support/com.piductor.app/piductor.db`,
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
): PiductorRootDirectoryService {
	const rootSnapshot: RootDirectorySnapshot = {
		archivedContextsPath: `${HOME}/Piductor/archived-contexts`,
		createdPaths: [],
		diagnostics: [],
		managedPaths: [
			{
				key: 'repos',
				path: `${HOME}/Piductor/repos`,
				status: 'present',
			},
			{
				key: 'workspaces',
				path: `${HOME}/Piductor/workspaces`,
				status: 'present',
			},
			{
				key: 'archived-contexts',
				path: `${HOME}/Piductor/archived-contexts`,
				status: 'present',
			},
		],
		path: `${HOME}/Piductor`,
		repositoriesPath: `${HOME}/Piductor/repos`,
		setting: null,
		source: 'built-in-default',
		status: 'ok',
		workspacesPath: `${HOME}/Piductor/workspaces`,
		...snapshot,
	};

	return {
		ensure: () => rootSnapshot,
		getSnapshot: () => rootSnapshot,
	};
}

function createLocalCommandService(
	options: {
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
		run: async () => ({
			args: ['-lc', 'printf piductor-process-ok'],
			command: '/bin/sh',
			cwd: HOME,
			durationMs: 1,
			endedAt: NOW.toISOString(),
			environment: null,
			exitCode: 0,
			logs: {
				command: '/bin/sh -lc printf',
				cwd: HOME,
				env: {},
				stderr: '',
				stdout: options.stdout ?? 'piductor-process-ok',
			},
			signal: null,
			startedAt: NOW.toISOString(),
			status: 'success',
			stderr: '',
			stderrTruncated: false,
			stdout: options.stdout ?? 'piductor-process-ok',
			stdoutTruncated: false,
		}),
	};
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

function createFutureProviders(
	overrides: Partial<Record<SetupCheckId, SetupCheckProvider>> = {},
): Partial<Record<SetupCheckId, SetupCheckProvider>> {
	return {
		...Object.fromEntries(
			FUTURE_REQUIRED_CHECKS.map((id) => [id, createProvider(id)]),
		),
		'linear-oauth': createProvider('linear-oauth', 'warning', false),
		...overrides,
	};
}

async function getSnapshot(
	options: {
		checkProviders?: Partial<Record<SetupCheckId, SetupCheckProvider>>;
		configService?: PiductorConfigService;
		databaseService?: PiductorDatabaseService;
		localCommandService?: LocalCommandService;
		rootDirectoryService?: PiductorRootDirectoryService;
	} = {},
) {
	const service = createSetupDiagnosticsService({
		checkProviders: createFutureProviders(options.checkProviders),
		configService: options.configService ?? createConfigService(),
		databaseService: options.databaseService ?? createDatabaseService(),
		homeDirectory: HOME,
		localCommandService:
			options.localCommandService ?? createLocalCommandService(),
		now: () => NOW,
		rootDirectoryService:
			options.rootDirectoryService ?? createRootDirectoryService(),
	});

	return service.getSnapshot();
}

test('reports ready when required checks pass and Linear is optional', async () => {
	const snapshot = await getSnapshot();

	assert.equal(snapshot.status, 'ready');
	assert.equal(snapshot.blockedCount, 0);
	assert.equal(snapshot.optionalCount, 1);
	assert.equal(snapshot.warningCount, 1);
	assert.equal(
		snapshot.checks.find((check) => check.id === 'linear-oauth')?.blocking,
		false,
	);
});

test('blocks readiness when a required provider check fails', async () => {
	const snapshot = await getSnapshot({
		checkProviders: {
			'git-executable': createProvider('git-executable', 'failure'),
		},
	});

	assert.equal(snapshot.status, 'blocked');
	assert.equal(snapshot.blockedCount, 1);
	assert.equal(
		snapshot.checks.find((check) => check.id === 'git-executable')?.status,
		'failure',
	);
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

test('redacts sensitive log assignments and collapses home paths', async () => {
	const snapshot = await getSnapshot({
		localCommandService: createLocalCommandService({
			stdout: `API_TOKEN=abc123 ${HOME}/Piductor/workspaces/demo`,
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
			log.text.includes('API_TOKEN=[REDACTED] ~/Piductor/workspaces/demo'),
		),
		true,
	);
});

test('keeps a stable setup check ordering', async () => {
	const snapshot = await getSnapshot();

	assert.deepEqual(
		snapshot.checks.map((check) => check.id),
		CHECK_ORDER,
	);
});
