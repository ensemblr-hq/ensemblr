import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import {
	ENSEMBLE_CONFIG_SCHEMA_VERSION,
	type EnsembleConfig,
	type EnsembleConfigService,
} from '../../src/main/config/config-loader.ts';
import type { EnsembleConfigResolutionService } from '../../src/main/config/config-resolution.ts';
import { createEnvironmentVariablesService } from '../../src/main/environment/environment-variables.ts';
import {
	createWorkspaceEnvironmentService,
	WorkspaceEnvironmentError,
} from '../../src/main/environment/workspace-environment.ts';
import {
	deriveWorkspacePortCandidate,
	isWorkspacePort,
	pickWorkspacePort,
	WORKSPACE_PORT_METADATA_KEY,
	WORKSPACE_PORT_RANGE_SIZE,
	WORKSPACE_PORT_RANGE_START,
} from '../../src/main/environment/workspace-ports.ts';
import type { EnsembleRootDirectoryService } from '../../src/main/root';
import { createMockSecretStore } from '../../src/main/secrets/secret-store.ts';
import type { EnsembleDatabaseService } from '../../src/main/storage/database.ts';
import { openEnsembleDatabase } from '../../src/main/storage/database.ts';
import { insertRepositoryRow } from '../../src/main/storage/repositories/repository-row-repository.ts';
import {
	insertWorkspaceRow,
	selectWorkspaceMetadataJson,
} from '../../src/main/storage/repositories/workspace-repository.ts';

const NOW = new Date('2026-06-11T00:00:00.000Z');
const ROOT_PATH = '/Users/alice/Ensemble';

function createConfigService(): EnsembleConfigService {
	const config: EnsembleConfig = {
		app: {},
		environment: {},
		managed: {},
		repositoryDefaults: {},
		repositoryRules: [],
		schemaVersion: ENSEMBLE_CONFIG_SCHEMA_VERSION,
		security: {},
		ui: {},
	};
	const snapshot = {
		blocksReadiness: false,
		diagnostics: [],
		displayPath: '~/.config/ensemble/config.json',
		loadedAt: NOW.toISOString(),
		path: '/Users/alice/.config/ensemble/config.json',
		schemaVersion: ENSEMBLE_CONFIG_SCHEMA_VERSION,
		status: 'ok' as const,
	};

	return {
		getConfig: () => config,
		getSnapshot: () => snapshot,
		load: () => snapshot,
	};
}

function createDatabaseFixture(t: TestContext): DatabaseSync {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemble-ws-env-'));
	const connection = openEnsembleDatabase({
		databasePath: path.join(directory, 'ensemble-test.db'),
	});

	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	return connection.database;
}

function createDatabaseServiceStub(
	database: DatabaseSync,
): EnsembleDatabaseService {
	return {
		getConnection: () => ({ database }),
	} as unknown as EnsembleDatabaseService;
}

function createRootDirectoryServiceStub(): EnsembleRootDirectoryService {
	const snapshot = {
		archivedContextsPath: path.join(ROOT_PATH, 'archived-contexts'),
		createdPaths: [],
		diagnostics: [],
		managedPaths: [],
		path: ROOT_PATH,
		repositoriesPath: path.join(ROOT_PATH, 'repos'),
		setting: null,
		source: null,
		status: 'ok',
		workspacesPath: path.join(ROOT_PATH, 'workspaces'),
	};

	return {
		applyChange: () => {
			throw new Error('not implemented');
		},
		ensure: () => snapshot,
		getSnapshot: () => snapshot,
		previewChange: () => {
			throw new Error('not implemented');
		},
	} as unknown as EnsembleRootDirectoryService;
}

function createSettingsResolutionStub(
	conductorCompatibility: boolean,
): EnsembleConfigResolutionService {
	return {
		resolve: () => ({
			app: { diagnostics: [], settings: [] },
			repository: {
				diagnostics: [],
				settings: [
					{
						candidates: [],
						key: 'conductorCompatibility',
						locked: false,
						source: 'built-in-default',
						value: conductorCompatibility,
					},
				],
			},
		}),
	};
}

function seedWorkspace({
	baseBranch = 'main',
	database,
	defaultBranch = 'main',
	metadataJson = '{}',
	repositoryId = 'repo-1',
	workspaceId = 'workspace-1',
	workspaceName = 'monterrey',
}: {
	baseBranch?: string | null;
	database: DatabaseSync;
	defaultBranch?: string | null;
	metadataJson?: string;
	repositoryId?: string;
	workspaceId?: string;
	workspaceName?: string;
}): { repositoryId: string; workspaceId: string; workspacePath: string } {
	const repositoryPath = path.join(ROOT_PATH, 'repos', 'ensemble');
	const workspacePath = path.join(
		ROOT_PATH,
		'workspaces',
		'ensemble',
		workspaceName,
	);
	const existingRepository = database
		.prepare('SELECT id FROM repositories WHERE id = ?')
		.get(repositoryId);

	if (!existingRepository) {
		insertRepositoryRow({
			database,
			defaultBranch,
			id: repositoryId,
			metadataJson: '{}',
			name: 'ensemble',
			path: repositoryPath,
			remoteUrl: '',
			slug: 'ensemble',
			timestamp: NOW.toISOString(),
		});
	}

	insertWorkspaceRow({
		baseBranch,
		branchName: `philipp/${workspaceName}`,
		database,
		id: workspaceId,
		metadataJson,
		name: workspaceName,
		path: workspacePath,
		repositoryId,
		slug: workspaceName,
		timestamp: NOW.toISOString(),
	});

	return { repositoryId, workspaceId, workspacePath };
}

function createService({
	conductorCompatibility = false,
	database,
	secretStore = createMockSecretStore(),
}: {
	conductorCompatibility?: boolean;
	database: DatabaseSync;
	secretStore?: ReturnType<typeof createMockSecretStore>;
}) {
	const environmentVariablesService = createEnvironmentVariablesService({
		configService: createConfigService(),
		database,
		now: () => NOW,
		secretStore,
	});

	return {
		environmentVariablesService,
		service: createWorkspaceEnvironmentService({
			databaseService: createDatabaseServiceStub(database),
			environmentVariablesService,
			rootDirectoryService: createRootDirectoryServiceStub(),
			settingsResolutionService: createSettingsResolutionStub(
				conductorCompatibility,
			),
		}),
	};
}

test('assemble injects native ENSEMBLE_* runtime variables', async (t) => {
	const database = createDatabaseFixture(t);
	const { workspaceId, workspacePath } = seedWorkspace({ database });
	const { service } = createService({ database });

	const assembly = await service.assemble({ workspaceId });

	assert.equal(assembly.env.ENSEMBLE_WORKSPACE_NAME, 'monterrey');
	assert.equal(assembly.env.ENSEMBLE_WORKSPACE_PATH, workspacePath);
	assert.equal(assembly.env.ENSEMBLE_ROOT_PATH, ROOT_PATH);
	assert.equal(assembly.env.ENSEMBLE_DEFAULT_BRANCH, 'main');
	assert.equal(assembly.env.ENSEMBLE_PORT, String(assembly.port));
	assert.equal(assembly.cwd, workspacePath);
	assert.ok(isWorkspacePort(assembly.port));
});

test('assemble omits CONDUCTOR_* mirrors without compatibility opt-in', async (t) => {
	const database = createDatabaseFixture(t);
	const { workspaceId } = seedWorkspace({ database });
	const { service } = createService({
		conductorCompatibility: false,
		database,
	});

	const assembly = await service.assemble({ workspaceId });

	assert.equal(assembly.conductorCompatibility, false);
	assert.equal(assembly.env.CONDUCTOR_WORKSPACE_NAME, undefined);
	assert.equal(assembly.env.CONDUCTOR_PORT, undefined);
});

test('assemble mirrors CONDUCTOR_* variables for compatible repositories', async (t) => {
	const database = createDatabaseFixture(t);
	const { workspaceId } = seedWorkspace({ database });
	const { service } = createService({ conductorCompatibility: true, database });

	const assembly = await service.assemble({ workspaceId });

	assert.equal(assembly.conductorCompatibility, true);
	assert.equal(
		assembly.env.CONDUCTOR_WORKSPACE_NAME,
		assembly.env.ENSEMBLE_WORKSPACE_NAME,
	);
	assert.equal(
		assembly.env.CONDUCTOR_WORKSPACE_PATH,
		assembly.env.ENSEMBLE_WORKSPACE_PATH,
	);
	assert.equal(
		assembly.env.CONDUCTOR_ROOT_PATH,
		assembly.env.ENSEMBLE_ROOT_PATH,
	);
	assert.equal(
		assembly.env.CONDUCTOR_DEFAULT_BRANCH,
		assembly.env.ENSEMBLE_DEFAULT_BRANCH,
	);
	assert.equal(assembly.env.CONDUCTOR_PORT, assembly.env.ENSEMBLE_PORT);
});

test('assemble layers configured variables with workspace > repository > app precedence', async (t) => {
	const database = createDatabaseFixture(t);
	const { repositoryId, workspaceId } = seedWorkspace({ database });
	const { environmentVariablesService, service } = createService({ database });

	await environmentVariablesService.setPlainValue({
		key: 'APP_ONLY',
		scope: 'app',
		value: 'from-app',
	});
	await environmentVariablesService.setPlainValue({
		key: 'LAYERED',
		scope: 'app',
		value: 'from-app',
	});
	await environmentVariablesService.setPlainValue({
		key: 'LAYERED',
		scope: 'repository',
		scopeId: repositoryId,
		value: 'from-repository',
	});
	await environmentVariablesService.setPlainValue({
		key: 'LAYERED',
		scope: 'workspace',
		scopeId: workspaceId,
		value: 'from-workspace',
	});

	const assembly = await service.assemble({ workspaceId });

	assert.equal(assembly.env.APP_ONLY, 'from-app');
	assert.equal(assembly.env.LAYERED, 'from-workspace');
});

test('assemble includes secret values and marks them for redaction', async (t) => {
	const database = createDatabaseFixture(t);
	const { workspaceId } = seedWorkspace({ database });
	const secretStore = createMockSecretStore();
	const { environmentVariablesService, service } = createService({
		database,
		secretStore,
	});

	await environmentVariablesService.setSecretValue({
		key: 'SERVICE_TOKEN',
		scope: 'workspace',
		scopeId: workspaceId,
		value: 'shh-secret',
	});

	const assembly = await service.assemble({ workspaceId });
	assert.equal(assembly.env.SERVICE_TOKEN, 'shh-secret');
	assert.ok(assembly.redactValues.includes('shh-secret'));

	const withoutSecrets = await service.assemble({
		includeSecrets: false,
		workspaceId,
	});
	assert.equal(withoutSecrets.env.SERVICE_TOKEN, undefined);
});

test('assemble persists the allocated port and keeps it stable', async (t) => {
	const database = createDatabaseFixture(t);
	const { workspaceId } = seedWorkspace({ database });
	const { service } = createService({ database });

	const first = await service.assemble({ workspaceId });
	const second = await service.assemble({ workspaceId });

	assert.equal(first.port, second.port);

	const metadataJson = selectWorkspaceMetadataJson({
		database,
		id: workspaceId,
	});
	assert.ok(metadataJson);
	const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
	assert.equal(metadata[WORKSPACE_PORT_METADATA_KEY], first.port);
});

test('assemble avoids ports held by other active workspaces', async (t) => {
	const database = createDatabaseFixture(t);
	const { workspaceId } = seedWorkspace({ database });
	const { service } = createService({ database });

	const first = await service.assemble({ workspaceId });

	seedWorkspace({
		database,
		metadataJson: JSON.stringify({
			[WORKSPACE_PORT_METADATA_KEY]: first.port,
		}),
		workspaceId: 'workspace-2',
		workspaceName: 'barcelona',
	});

	const sibling = await service.assemble({ workspaceId: 'workspace-2' });
	// The sibling persisted the same port first, so it keeps it only when free;
	// since workspace-1 holds it, the sibling must move elsewhere.
	assert.notEqual(sibling.port, first.port);
	assert.ok(isWorkspacePort(sibling.port));
});

test('assemble warns instead of setting an unknown default branch', async (t) => {
	const database = createDatabaseFixture(t);
	const { workspaceId } = seedWorkspace({
		baseBranch: null,
		database,
		defaultBranch: null,
	});
	const { service } = createService({ database });

	const assembly = await service.assemble({ workspaceId });

	assert.equal(assembly.env.ENSEMBLE_DEFAULT_BRANCH, undefined);
	assert.ok(
		assembly.diagnostics.some(
			(diagnostic) => diagnostic.code === 'default-branch-unknown',
		),
	);
});

test('assemble rejects unknown workspaces', async (t) => {
	const database = createDatabaseFixture(t);
	const { service } = createService({ database });

	await assert.rejects(
		service.assemble({ workspaceId: 'missing' }),
		(error: unknown) =>
			error instanceof WorkspaceEnvironmentError &&
			error.code === 'workspace-not-found',
	);
});

test('deriveWorkspacePortCandidate is deterministic and in range', () => {
	const first = deriveWorkspacePortCandidate('workspace-1');
	const second = deriveWorkspacePortCandidate('workspace-1');

	assert.equal(first, second);
	assert.ok(first >= WORKSPACE_PORT_RANGE_START);
	assert.ok(first < WORKSPACE_PORT_RANGE_START + WORKSPACE_PORT_RANGE_SIZE);
});

test('pickWorkspacePort keeps a free preferred port and probes past collisions', () => {
	const preferred = WORKSPACE_PORT_RANGE_START + 5;

	assert.equal(
		pickWorkspacePort({
			preferredPort: preferred,
			usedPorts: new Set(),
			workspaceId: 'workspace-1',
		}),
		preferred,
	);

	const candidate = deriveWorkspacePortCandidate('workspace-1');
	const probed = pickWorkspacePort({
		preferredPort: null,
		usedPorts: new Set([candidate]),
		workspaceId: 'workspace-1',
	});

	assert.notEqual(probed, candidate);
	assert.ok(isWorkspacePort(probed));
});
