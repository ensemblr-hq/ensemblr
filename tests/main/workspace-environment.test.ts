import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import {
	ENSEMBLR_CONFIG_SCHEMA_VERSION,
	type EnsemblrConfig,
	type EnsemblrConfigService,
} from '../../src/main/config/config-loader.ts';
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
import type { EnsemblrRootDirectoryService } from '../../src/main/root';
import { createMockSecretStore } from '../../src/main/secrets/secret-store.ts';
import type { EnsemblrDatabaseService } from '../../src/main/storage/database.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import { insertRepositoryRow } from '../../src/main/storage/repositories/repository-row-repository.ts';
import {
	insertWorkspaceRow,
	selectWorkspaceMetadataJson,
} from '../../src/main/storage/repositories/workspace-repository.ts';

const NOW = new Date('2026-06-11T00:00:00.000Z');
const ROOT_PATH = '/Users/alice/Ensemblr';

function createConfigService(): EnsemblrConfigService {
	const config: EnsemblrConfig = {
		app: {},
		environment: {},
		managed: {},
		repositoryDefaults: {},
		repositoryRules: [],
		schemaVersion: ENSEMBLR_CONFIG_SCHEMA_VERSION,
		security: {},
		ui: {},
	};
	const snapshot = {
		blocksReadiness: false,
		diagnostics: [],
		displayPath: '~/.config/ensemblr/config.json',
		loadedAt: NOW.toISOString(),
		path: '/Users/alice/.config/ensemblr/config.json',
		schemaVersion: ENSEMBLR_CONFIG_SCHEMA_VERSION,
		status: 'ok' as const,
	};

	return {
		getConfig: () => config,
		getSnapshot: () => snapshot,
		load: () => snapshot,
	};
}

function createDatabaseFixture(t: TestContext): DatabaseSync {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-ws-env-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'ensemblr-test.db'),
	});

	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	return connection.database;
}

function createDatabaseServiceStub(
	database: DatabaseSync,
): EnsemblrDatabaseService {
	return {
		getConnection: () => ({ database }),
	} as unknown as EnsemblrDatabaseService;
}

function createRootDirectoryServiceStub(): EnsemblrRootDirectoryService {
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
	} as unknown as EnsemblrRootDirectoryService;
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
	const repositoryPath = path.join(ROOT_PATH, 'repos', 'ensemblr');
	const workspacePath = path.join(
		ROOT_PATH,
		'workspaces',
		'ensemblr',
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
			name: 'ensemblr',
			path: repositoryPath,
			remoteUrl: '',
			slug: 'ensemblr',
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
	database,
	resolveToolchainPath,
	secretStore = createMockSecretStore(),
}: {
	database: DatabaseSync;
	resolveToolchainPath?: (cwd: string) => Promise<string | null>;
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
			resolveToolchainPath,
			rootDirectoryService: createRootDirectoryServiceStub(),
		}),
	};
}

test('assemble injects native ENSEMBLR_* runtime variables', async (t) => {
	const database = createDatabaseFixture(t);
	const { workspaceId, workspacePath } = seedWorkspace({ database });
	const { service } = createService({ database });

	const assembly = await service.assemble({ workspaceId });

	assert.equal(assembly.env.ENSEMBLR_WORKSPACE_NAME, 'monterrey');
	assert.equal(assembly.env.ENSEMBLR_WORKSPACE_PATH, workspacePath);
	assert.equal(assembly.env.ENSEMBLR_ROOT_PATH, ROOT_PATH);
	assert.equal(assembly.env.ENSEMBLR_DEFAULT_BRANCH, 'main');
	assert.equal(assembly.env.ENSEMBLR_PORT, String(assembly.port));
	assert.equal(assembly.cwd, workspacePath);
	assert.ok(isWorkspacePort(assembly.port));
});

test('assemble does not expose CONDUCTOR_* mirrors', async (t) => {
	const database = createDatabaseFixture(t);
	const { workspaceId } = seedWorkspace({ database });
	const { service } = createService({ database });

	const assembly = await service.assemble({ workspaceId });

	assert.equal(assembly.env.CONDUCTOR_WORKSPACE_NAME, undefined);
	assert.equal(assembly.env.CONDUCTOR_WORKSPACE_PATH, undefined);
	assert.equal(assembly.env.CONDUCTOR_ROOT_PATH, undefined);
	assert.equal(assembly.env.CONDUCTOR_DEFAULT_BRANCH, undefined);
	assert.equal(assembly.env.CONDUCTOR_PORT, undefined);
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

test('assemble injects the resolved toolchain PATH for the workspace directory', async (t) => {
	const database = createDatabaseFixture(t);
	const { workspaceId, workspacePath } = seedWorkspace({ database });
	const resolvedCwds: string[] = [];
	const { service } = createService({
		database,
		resolveToolchainPath: async (cwd) => {
			resolvedCwds.push(cwd);
			return `${cwd}/.mise/node/bin:/usr/bin:/bin`;
		},
	});

	const assembly = await service.assemble({ workspaceId });

	assert.deepEqual(resolvedCwds, [workspacePath]);
	assert.equal(
		assembly.env.PATH,
		`${workspacePath}/.mise/node/bin:/usr/bin:/bin`,
	);
});

test('assemble leaves PATH unset when the toolchain resolver returns null', async (t) => {
	const database = createDatabaseFixture(t);
	const { workspaceId } = seedWorkspace({ database });
	const { service } = createService({
		database,
		resolveToolchainPath: async () => null,
	});

	const assembly = await service.assemble({ workspaceId });

	assert.equal(assembly.env.PATH, undefined);
	assert.ok(
		assembly.diagnostics.some(
			(diagnostic) => diagnostic.code === 'toolchain-path-unresolved',
		),
		'expected a diagnostic when the toolchain PATH could not be resolved',
	);
});

test('assemble keeps a configured empty PATH override over the resolved toolchain PATH', async (t) => {
	const database = createDatabaseFixture(t);
	const { workspaceId } = seedWorkspace({ database });
	let resolverCalls = 0;
	const { environmentVariablesService, service } = createService({
		database,
		resolveToolchainPath: async () => {
			resolverCalls += 1;
			return '/resolved/bin:/usr/bin';
		},
	});

	await environmentVariablesService.setPlainValue({
		key: 'PATH',
		scope: 'workspace',
		scopeId: workspaceId,
		value: '',
	});

	const assembly = await service.assemble({ workspaceId });

	assert.equal(assembly.env.PATH, '');
	assert.equal(resolverCalls, 0);
});

test('assemble keeps a configured PATH override over the resolved toolchain PATH', async (t) => {
	const database = createDatabaseFixture(t);
	const { workspaceId } = seedWorkspace({ database });
	const { environmentVariablesService, service } = createService({
		database,
		resolveToolchainPath: async () => '/resolved/bin:/usr/bin',
	});

	await environmentVariablesService.setPlainValue({
		key: 'PATH',
		scope: 'workspace',
		scopeId: workspaceId,
		value: '/user/override/bin',
	});

	const assembly = await service.assemble({ workspaceId });

	assert.equal(assembly.env.PATH, '/user/override/bin');
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

	assert.equal(assembly.env.ENSEMBLR_DEFAULT_BRANCH, undefined);
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
