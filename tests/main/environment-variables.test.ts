import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import {
	ENSEMBLE_CONFIG_SCHEMA_VERSION,
	type EnsembleConfig,
	type EnsembleConfigService,
} from '../../src/main/config/config-loader.ts';
import {
	createEnvironmentVariablesService,
	EnvironmentVariablesError,
	isEnvironmentVariableKey,
} from '../../src/main/environment/environment-variables.ts';
import { createMockSecretStore } from '../../src/main/secrets/secret-store.ts';
import { openEnsembleDatabase } from '../../src/main/storage/database.ts';
import type {
	EnvironmentVariableSnapshot,
	EnvironmentVariablesSnapshot,
} from '../../src/shared/ipc/index.ts';

const NOW = new Date('2026-06-05T00:00:00.000Z');

function createConfigService(
	environment: Record<string, unknown> = {},
): EnsembleConfigService {
	const config: EnsembleConfig = {
		app: {},
		environment,
		managed: {},
		repositoryDefaults: {},
		repositoryRules: [],
		schemaVersion: ENSEMBLE_CONFIG_SCHEMA_VERSION,
		security: {},
		ui: {},
	};

	return {
		getConfig: () => config,
		getSnapshot: () => ({
			blocksReadiness: false,
			diagnostics: [],
			displayPath: '~/.config/ensemble/config.json',
			loadedAt: NOW.toISOString(),
			path: '/Users/alice/.config/ensemble/config.json',
			schemaVersion: ENSEMBLE_CONFIG_SCHEMA_VERSION,
			status: 'ok',
		}),
		load: () => ({
			blocksReadiness: false,
			diagnostics: [],
			displayPath: '~/.config/ensemble/config.json',
			loadedAt: NOW.toISOString(),
			path: '/Users/alice/.config/ensemble/config.json',
			schemaVersion: ENSEMBLE_CONFIG_SCHEMA_VERSION,
			status: 'ok',
		}),
	};
}

function createDatabaseFixture(t: TestContext): DatabaseSync {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemble-env-'));
	const connection = openEnsembleDatabase({
		databasePath: path.join(directory, 'ensemble-test.db'),
	});

	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	return connection.database;
}

function createService({
	database,
	environment,
	secretStore = createMockSecretStore({
		idFactory: () => 'secret-1',
		now: () => NOW,
	}),
}: {
	database?: DatabaseSync;
	environment?: Record<string, unknown>;
	secretStore?: ReturnType<typeof createMockSecretStore>;
} = {}) {
	return createEnvironmentVariablesService({
		configService: createConfigService(environment),
		database: database ?? null,
		now: () => NOW,
		secretStore,
	});
}

function getVariable(
	snapshot: EnvironmentVariablesSnapshot,
	key: string,
): EnvironmentVariableSnapshot {
	const variable = snapshot.variables.find(
		(candidate) => candidate.key === key,
	);

	if (!variable) {
		assert.fail(`Expected environment variable ${key}`);
	}

	return variable;
}

test('validates environment variable keys', () => {
	assert.equal(isEnvironmentVariableKey('OPENAI_API_KEY'), true);
	assert.equal(isEnvironmentVariableKey('_CUSTOM'), true);
	assert.equal(isEnvironmentVariableKey('1_BAD'), false);
	assert.equal(isEnvironmentVariableKey('BAD-NAME'), false);
});

test('catalog snapshot includes unset, secret, and reserved variables', async () => {
	const snapshot = await createService().getSnapshot();

	assert.equal(getVariable(snapshot, 'PI_CODING_AGENT_DIR').status, 'unset');
	assert.equal(getVariable(snapshot, 'OPENAI_API_KEY').valueKind, 'secret');
	assert.equal(getVariable(snapshot, 'OPENAI_API_KEY').status, 'unset');
	assert.deepEqual(
		{
			source: getVariable(snapshot, 'ENSEMBLE_PORT').source,
			status: getVariable(snapshot, 'ENSEMBLE_PORT').status,
			valueKind: getVariable(snapshot, 'ENSEMBLE_PORT').valueKind,
		},
		{
			source: 'runtime',
			status: 'reserved',
			valueKind: 'runtime',
		},
	);
});

test('uses non-secret config defaults and rejects secret config values', async () => {
	const snapshot = await createService({
		environment: {
			DEBUG: 'ensemble:*',
			OPENAI_API_KEY: 'sk-raw-config-secret',
		},
	}).getSnapshot();

	assert.deepEqual(
		{
			displayValue: getVariable(snapshot, 'DEBUG').displayValue,
			source: getVariable(snapshot, 'DEBUG').source,
			status: getVariable(snapshot, 'DEBUG').status,
		},
		{
			displayValue: 'ensemble:*',
			source: 'config-default',
			status: 'set',
		},
	);
	assert.equal(getVariable(snapshot, 'OPENAI_API_KEY').status, 'invalid');
	assert.equal(
		snapshot.diagnostics.some(
			(diagnostic) =>
				diagnostic.code === 'secret-config-variable-ignored' &&
				diagnostic.key === 'OPENAI_API_KEY',
		),
		true,
	);
});

test('stores and assembles non-secret sqlite values', async (t) => {
	const database = createDatabaseFixture(t);
	const service = createService({ database });

	const stored = await service.setPlainValue({
		key: 'DEBUG',
		value: 'ensemble:setup',
	});
	const snapshot = await service.getSnapshot();
	const assembly = await service.assembleEnvironment();
	const rows = database.prepare('SELECT key, value_json FROM settings').all();

	assert.equal(stored.status, 'set');
	assert.equal(getVariable(snapshot, 'DEBUG').source, 'sqlite');
	assert.equal(getVariable(snapshot, 'DEBUG').displayValue, 'ensemble:setup');
	assert.deepEqual(assembly.env, { DEBUG: 'ensemble:setup' });
	assert.deepEqual(assembly.redactValues, []);
	assert.equal(JSON.stringify(rows).includes('ensemble:setup'), true);
});

test('stores secret values through secret metadata without exposing raw values in snapshots or sqlite', async (t) => {
	const database = createDatabaseFixture(t);
	const secretStore = createMockSecretStore({
		idFactory: () => 'secret-env-1',
		now: () => NOW,
	});
	const service = createService({ database, secretStore });
	const rawSecret = 'sk-env-secret-123456';

	const stored = await service.setSecretValue({
		key: 'OPENAI_API_KEY',
		value: rawSecret,
	});
	const snapshot = await service.getSnapshot();
	const variable = getVariable(snapshot, 'OPENAI_API_KEY');
	const assembly = await service.assembleEnvironment();
	const sqliteRows = [
		...database.prepare('SELECT * FROM settings').all(),
		...database.prepare('SELECT * FROM secret_metadata').all(),
	];

	assert.equal(stored.maskedDisplay, '****3456');
	assert.equal(variable.status, 'masked');
	assert.equal(variable.maskedDisplay, '****3456');
	assert.equal(JSON.stringify(snapshot).includes(rawSecret), false);
	assert.deepEqual(assembly.env, { OPENAI_API_KEY: rawSecret });
	assert.deepEqual(assembly.redactValues, [rawSecret]);
	assert.equal(JSON.stringify(sqliteRows).includes(rawSecret), false);
});

test('keeps plain and secret storage mutually exclusive when value kind changes', async (t) => {
	const database = createDatabaseFixture(t);
	const secretStore = createMockSecretStore({
		idFactory: () => 'secret-env-1',
		now: () => NOW,
	});
	const service = createService({ database, secretStore });

	await service.setPlainValue({
		key: 'DEBUG',
		value: 'ensemble:plain',
	});
	await service.setSecretValue({
		key: 'DEBUG',
		value: 'ensemble-secret',
	});

	assert.deepEqual((await service.assembleEnvironment()).env, {
		DEBUG: 'ensemble-secret',
	});
	assert.deepEqual(
		(await service.assembleEnvironment({ includeSecrets: false })).env,
		{},
	);

	await service.setPlainValue({
		key: 'DEBUG',
		value: 'ensemble:plain-again',
	});

	const snapshot = await service.getSnapshot();

	assert.deepEqual((await service.assembleEnvironment()).env, {
		DEBUG: 'ensemble:plain-again',
	});
	assert.equal(getVariable(snapshot, 'DEBUG').status, 'set');
	assert.equal(getVariable(snapshot, 'DEBUG').source, 'sqlite');
});

test('reports missing required variables without printing values', async () => {
	const snapshot = await createService().getSnapshot({
		requiredKeys: ['ENSEMBLE_REQUIRED_TOKEN'],
	});
	const variable = getVariable(snapshot, 'ENSEMBLE_REQUIRED_TOKEN');

	assert.equal(snapshot.requiredCount, 1);
	assert.equal(snapshot.missingRequiredCount, 1);
	assert.equal(variable.required, true);
	assert.equal(variable.status, 'unset');
	assert.equal(
		snapshot.diagnostics.some(
			(diagnostic) =>
				diagnostic.code === 'required-variable-missing' &&
				diagnostic.key === 'ENSEMBLE_REQUIRED_TOKEN',
		),
		true,
	);
});

test('rejects invalid, reserved, and secret-classified plain writes', async (t) => {
	const database = createDatabaseFixture(t);
	const service = createService({ database });

	await assert.rejects(
		service.setPlainValue({ key: 'BAD-NAME', value: 'x' }),
		(error) =>
			error instanceof EnvironmentVariablesError &&
			error.code === 'invalid-key',
	);
	await assert.rejects(
		service.setPlainValue({ key: 'ENSEMBLE_PORT', value: '5173' }),
		(error) =>
			error instanceof EnvironmentVariablesError &&
			error.code === 'reserved-key',
	);
	await assert.rejects(
		service.setPlainValue({ key: 'OPENAI_API_KEY', value: 'sk-test' }),
		(error) =>
			error instanceof EnvironmentVariablesError &&
			error.code === 'secret-value-required',
	);
});

test('setValue auto-routes secret-classified and plain keys', async (t) => {
	const database = createDatabaseFixture(t);
	const secretStore = createMockSecretStore({
		idFactory: () => 'secret-route-1',
		now: () => NOW,
	});
	const service = createService({ database, secretStore });

	const secret = await service.setValue({
		key: 'ANTHROPIC_API_KEY',
		value: 'sk-secret-route',
	});
	const plain = await service.setValue({ key: 'DEBUG', value: 'ensemble:*' });

	assert.equal(secret.status, 'masked');
	assert.equal(secret.valueKind, 'secret');
	assert.equal(plain.status, 'set');
	assert.equal(plain.valueKind, 'plain');
});

test('readValue returns plain and secret stored values', async (t) => {
	const database = createDatabaseFixture(t);
	const secretStore = createMockSecretStore({
		idFactory: () => 'secret-read-1',
		now: () => NOW,
	});
	const service = createService({ database, secretStore });

	await service.setValue({ key: 'DEBUG', value: 'ensemble:read' });
	await service.setValue({ key: 'OPENAI_API_KEY', value: 'sk-read-secret' });

	assert.equal(await service.readValue({ key: 'DEBUG' }), 'ensemble:read');
	assert.equal(
		await service.readValue({ key: 'OPENAI_API_KEY' }),
		'sk-read-secret',
	);
	assert.equal(await service.readValue({ key: 'UNSET_VARIABLE' }), null);
});

test('env files round-trip and seed assembled environment below explicit vars', async (t) => {
	const database = createDatabaseFixture(t);
	const service = createService({ database });
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemble-envfile-'));
	const envFilePath = path.join(directory, '.env');

	writeFileSync(
		envFilePath,
		[
			'# comment',
			'export FROM_FILE=file-value',
			'DEBUG=file-debug',
			'ENSEMBLE_PORT=9999',
		].join('\n'),
		'utf8',
	);

	t.after(() => {
		rmSync(directory, { force: true, recursive: true });
	});

	const afterAdd = await service.addEnvFile({ path: envFilePath });
	assert.deepEqual(afterAdd, [envFilePath]);
	assert.deepEqual(await service.listEnvFiles(), [envFilePath]);

	// Explicit var wins over the file value; reserved keys are never sourced.
	await service.setValue({ key: 'DEBUG', value: 'explicit-debug' });
	const assembly = await service.assembleEnvironment();

	assert.equal(assembly.env.FROM_FILE, 'file-value');
	assert.equal(assembly.env.DEBUG, 'explicit-debug');
	assert.equal(assembly.env.ENSEMBLE_PORT, undefined);

	const afterRemove = await service.removeEnvFile({ path: envFilePath });
	assert.deepEqual(afterRemove, []);
	assert.equal((await service.assembleEnvironment()).env.FROM_FILE, undefined);
});

test('addEnvFile rejects a path that does not exist', async (t) => {
	const database = createDatabaseFixture(t);
	const service = createService({ database });
	const missingPath = path.join(tmpdir(), 'ensemble-missing-env-file.env');

	await assert.rejects(
		() => service.addEnvFile({ path: missingPath }),
		(error: unknown) =>
			error instanceof EnvironmentVariablesError &&
			error.code === 'env-file-not-found',
	);
});

test('assembleEnvironment warns when a configured env file disappears', async (t) => {
	const database = createDatabaseFixture(t);
	const service = createService({ database });
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemble-envfile-gone-'));
	const envFilePath = path.join(directory, '.env');

	writeFileSync(envFilePath, 'A=1\n', 'utf8');

	t.after(() => {
		rmSync(directory, { force: true, recursive: true });
	});

	await service.addEnvFile({ path: envFilePath });
	// The file is removed after it was registered.
	rmSync(envFilePath, { force: true });
	const assembly = await service.assembleEnvironment();

	assert.equal(
		assembly.diagnostics.some(
			(diagnostic) => diagnostic.code === 'env-file-unreadable',
		),
		true,
	);
});

test('assembleEnvironment redacts secret-shaped env-file values', async (t) => {
	const database = createDatabaseFixture(t);
	const service = createService({ database });
	const directory = mkdtempSync(
		path.join(tmpdir(), 'ensemble-envfile-secret-'),
	);
	const envFilePath = path.join(directory, '.env');

	writeFileSync(
		envFilePath,
		['OPENAI_API_KEY=sk-from-file', 'PLAIN_VAR=plain-value'].join('\n'),
		'utf8',
	);

	t.after(() => {
		rmSync(directory, { force: true, recursive: true });
	});

	await service.addEnvFile({ path: envFilePath });
	const assembly = await service.assembleEnvironment();

	assert.equal(assembly.env.OPENAI_API_KEY, 'sk-from-file');
	assert.equal(assembly.redactValues.includes('sk-from-file'), true);
	assert.equal(assembly.redactValues.includes('plain-value'), false);
});

test('getSnapshot counts an env-file value as satisfying a required key', async (t) => {
	const database = createDatabaseFixture(t);
	const service = createService({ database });
	const directory = mkdtempSync(
		path.join(tmpdir(), 'ensemble-envfile-required-'),
	);
	const envFilePath = path.join(directory, '.env');

	writeFileSync(envFilePath, 'REQUIRED_FROM_FILE=present\n', 'utf8');

	t.after(() => {
		rmSync(directory, { force: true, recursive: true });
	});

	const before = await service.getSnapshot({
		requiredKeys: ['REQUIRED_FROM_FILE'],
	});
	assert.equal(before.missingRequiredCount, 1);

	await service.addEnvFile({ path: envFilePath });
	const after = await service.getSnapshot({
		requiredKeys: ['REQUIRED_FROM_FILE'],
	});
	assert.equal(after.missingRequiredCount, 0);
});
