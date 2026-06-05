import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import {
	ENSEMBLE_CONFIG_SCHEMA_VERSION,
	type EnsembleConfig,
} from '../../src/main/config/config-loader.ts';
import {
	normalizeSettingsResolutionRequest,
	resolveSettings,
} from '../../src/main/config/config-resolution.ts';
import { openEnsembleDatabase } from '../../src/main/storage/database.ts';
import type { SettingsResolutionGroupSnapshot } from '../../src/shared/ipc.ts';

let settingCounter = 0;
const previewUrlTemplate = 'http://localhost:$' + '{ENSEMBLE_PORT}';

function createConfig(overrides: Partial<EnsembleConfig> = {}): EnsembleConfig {
	return {
		app: {},
		environment: {},
		managed: {},
		repositoryDefaults: {},
		repositoryRules: [],
		schemaVersion: ENSEMBLE_CONFIG_SCHEMA_VERSION,
		security: {},
		ui: {},
		...overrides,
	};
}

function createDatabaseFixture(t: TestContext): DatabaseSync {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemble-resolution-'));
	const connection = openEnsembleDatabase({
		databasePath: path.join(directory, 'ensemble-test.db'),
	});

	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	return connection.database;
}

function insertSetting({
	database,
	key,
	scope,
	scopeId = '',
	valueJson,
}: {
	database: DatabaseSync;
	key: string;
	scope: 'app' | 'repository';
	scopeId?: string;
	valueJson: string;
}): void {
	settingCounter += 1;
	database
		.prepare(
			`INSERT INTO settings (id, scope, scope_id, key, value_json)
			 VALUES (?, ?, ?, ?, ?)`,
		)
		.run(`setting-${settingCounter}`, scope, scopeId, key, valueJson);
}

function getSetting(group: SettingsResolutionGroupSnapshot, key: string) {
	const setting = group.settings.find((candidate) => candidate.key === key);

	if (!setting) {
		assert.fail(`Expected resolved setting "${key}"`);
	}

	return setting;
}

test('resolves app settings from sqlite, config defaults, and built-in defaults', (t) => {
	const database = createDatabaseFixture(t);
	insertSetting({
		database,
		key: 'sendShortcut',
		scope: 'app',
		valueJson: JSON.stringify('command-enter'),
	});

	const snapshot = resolveSettings({
		config: createConfig({
			app: { sendShortcut: 'enter' },
			ui: { theme: 'dark' },
		}),
		database,
		homeDirectory: '/Users/example',
	});

	assert.deepEqual(
		{
			source: getSetting(snapshot.app, 'sendShortcut').source,
			value: getSetting(snapshot.app, 'sendShortcut').value,
		},
		{ source: 'sqlite', value: 'command-enter' },
	);
	assert.deepEqual(
		{
			source: getSetting(snapshot.app, 'ui.theme').source,
			value: getSetting(snapshot.app, 'ui.theme').value,
		},
		{ source: 'config-default', value: 'dark' },
	);
	assert.deepEqual(
		{
			source: getSetting(snapshot.app, 'rootDirectory').source,
			value: getSetting(snapshot.app, 'rootDirectory').value,
		},
		{
			source: 'built-in-default',
			value: '/Users/example/Ensemble',
		},
	);
	assert.deepEqual(
		{
			source: getSetting(snapshot.app, 'security.permissionMode').source,
			value: getSetting(snapshot.app, 'security.permissionMode').value,
		},
		{
			source: 'built-in-default',
			value: 'workspace-trusted',
		},
	);
});

test('managed locked settings override sqlite user settings', (t) => {
	const database = createDatabaseFixture(t);
	insertSetting({
		database,
		key: 'rootDirectory',
		scope: 'app',
		valueJson: JSON.stringify('/sqlite/root'),
	});

	const snapshot = resolveSettings({
		config: createConfig({
			app: { rootDirectory: '/config/root' },
			managed: {
				locked: { rootDirectory: true },
				values: { rootDirectory: '/managed/root' },
			},
		}),
		database,
		homeDirectory: '/Users/example',
	});
	const rootDirectory = getSetting(snapshot.app, 'rootDirectory');

	assert.equal(rootDirectory.source, 'managed-config');
	assert.equal(rootDirectory.value, '/managed/root');
	assert.equal(rootDirectory.locked, true);
	assert.deepEqual(rootDirectory.candidates, [
		{
			reason: 'Selected by precedence.',
			source: 'managed-config',
			status: 'selected',
		},
		{
			reason: 'Ignored because this setting is locked by managed config.',
			source: 'sqlite',
			status: 'ignored',
		},
		{
			reason: 'Ignored because managed-config has higher precedence.',
			source: 'config-default',
			status: 'ignored',
		},
		{
			reason: 'Ignored because managed-config has higher precedence.',
			source: 'built-in-default',
			status: 'ignored',
		},
	]);
});

test('invalid sqlite setting JSON falls back to the next valid source', (t) => {
	const database = createDatabaseFixture(t);
	insertSetting({
		database,
		key: 'sendShortcut',
		scope: 'app',
		valueJson: 'not-json',
	});

	const snapshot = resolveSettings({
		config: createConfig({ app: { sendShortcut: 'enter' } }),
		database,
	});
	const sendShortcut = getSetting(snapshot.app, 'sendShortcut');

	assert.equal(sendShortcut.source, 'config-default');
	assert.equal(sendShortcut.value, 'enter');
	assert.deepEqual(sendShortcut.candidates, [
		{
			reason: 'Stored SQLite setting value is not valid JSON.',
			source: 'sqlite',
			status: 'invalid',
		},
		{
			reason: 'Selected by precedence.',
			source: 'config-default',
			status: 'selected',
		},
		{
			reason: 'Ignored because config-default has higher precedence.',
			source: 'built-in-default',
			status: 'ignored',
		},
	]);
	assert.equal(
		snapshot.app.diagnostics.some(
			(diagnostic) =>
				diagnostic.key === 'sendShortcut' &&
				diagnostic.source === 'sqlite' &&
				diagnostic.status === 'invalid',
		),
		true,
	);
});

test('resolves repository settings from sqlite and provided config snapshots', (t) => {
	const database = createDatabaseFixture(t);
	insertSetting({
		database,
		key: 'scripts.run',
		scope: 'repository',
		scopeId: 'repo-1',
		valueJson: JSON.stringify('bun run sqlite'),
	});

	const snapshot = resolveSettings({
		config: createConfig(),
		database,
		repository: {
			conductorConfig: {
				scripts: {
					run: 'bun run conductor',
					setup: 'bun install',
				},
			},
			ensembleConfig: {
				previewUrlTemplate,
				scripts: { run: 'bun run ensemble' },
			},
			repositoryId: 'repo-1',
		},
	});

	if (!snapshot.repository) {
		assert.fail('Expected repository settings resolution');
	}

	assert.deepEqual(
		{
			source: getSetting(snapshot.repository, 'scripts.run').source,
			value: getSetting(snapshot.repository, 'scripts.run').value,
		},
		{ source: 'sqlite', value: 'bun run sqlite' },
	);
	assert.deepEqual(
		{
			source: getSetting(snapshot.repository, 'previewUrlTemplate').source,
			value: getSetting(snapshot.repository, 'previewUrlTemplate').value,
		},
		{
			source: 'ensemble-config',
			value: previewUrlTemplate,
		},
	);
	assert.deepEqual(
		{
			source: getSetting(snapshot.repository, 'scripts.setup').source,
			value: getSetting(snapshot.repository, 'scripts.setup').value,
		},
		{ source: 'conductor-config', value: 'bun install' },
	);
	assert.deepEqual(
		{
			source: getSetting(snapshot.repository, 'conductorCompatibility').source,
			value: getSetting(snapshot.repository, 'conductorCompatibility').value,
		},
		{ source: 'conductor-config', value: true },
	);
	assert.deepEqual(
		{
			source: getSetting(snapshot.repository, 'filesToCopy').source,
			value: getSetting(snapshot.repository, 'filesToCopy').value,
		},
		{ source: 'built-in-default', value: ['.env*'] },
	);
	assert.deepEqual(
		{
			source: getSetting(snapshot.repository, 'security.permissionMode').source,
			value: getSetting(snapshot.repository, 'security.permissionMode').value,
		},
		{ source: 'built-in-default', value: 'workspace-trusted' },
	);
	assert.deepEqual(getSetting(snapshot.repository, 'scripts.run').candidates, [
		{
			reason: 'Selected by precedence.',
			source: 'sqlite',
			status: 'selected',
		},
		{
			reason: 'Ignored because sqlite has higher precedence.',
			source: 'ensemble-config',
			status: 'ignored',
		},
		{
			reason: 'Ignored because sqlite has higher precedence.',
			source: 'conductor-config',
			status: 'ignored',
		},
		{
			reason: 'Ignored because sqlite has higher precedence.',
			source: 'built-in-default',
			status: 'ignored',
		},
	]);
});

test('explicit repository sources override inferred conductor compatibility', () => {
	const snapshot = resolveSettings({
		config: createConfig(),
		repository: {
			conductorConfig: { scripts: { setup: 'bun install' } },
			ensembleConfig: { conductorCompatibility: false },
			repositoryId: 'repo-1',
		},
	});

	if (!snapshot.repository) {
		assert.fail('Expected repository settings resolution');
	}

	assert.deepEqual(
		{
			source: getSetting(snapshot.repository, 'conductorCompatibility').source,
			value: getSetting(snapshot.repository, 'conductorCompatibility').value,
		},
		{ source: 'ensemble-config', value: false },
	);
});

test('invalid app permission mode falls back to the next valid source', (t) => {
	const database = createDatabaseFixture(t);
	insertSetting({
		database,
		key: 'security.permissionMode',
		scope: 'app',
		valueJson: JSON.stringify('sandboxed'),
	});

	const snapshot = resolveSettings({
		config: createConfig({
			security: { permissionMode: 'approval-required' },
		}),
		database,
	});
	const permissionMode = getSetting(snapshot.app, 'security.permissionMode');

	assert.equal(permissionMode.source, 'config-default');
	assert.equal(permissionMode.value, 'approval-required');
	assert.deepEqual(permissionMode.candidates, [
		{
			reason:
				'Invalid permission mode "sandboxed". Expected one of: workspace-trusted, approval-required, read-only.',
			source: 'sqlite',
			status: 'invalid',
		},
		{
			reason: 'Selected by precedence.',
			source: 'config-default',
			status: 'selected',
		},
		{
			reason: 'Ignored because config-default has higher precedence.',
			source: 'built-in-default',
			status: 'ignored',
		},
	]);
	assert.equal(
		snapshot.app.diagnostics.some(
			(diagnostic) =>
				diagnostic.key === 'security.permissionMode' &&
				diagnostic.source === 'sqlite' &&
				diagnostic.status === 'invalid',
		),
		true,
	);
});

test('invalid repository permission mode falls back by source precedence', () => {
	const snapshot = resolveSettings({
		config: createConfig(),
		repository: {
			conductorConfig: { security: { permissionMode: 'approval-required' } },
			ensembleConfig: { security: { permissionMode: 'sandboxed' } },
			repositoryId: 'repo-1',
		},
	});

	if (!snapshot.repository) {
		assert.fail('Expected repository settings resolution');
	}

	const permissionMode = getSetting(
		snapshot.repository,
		'security.permissionMode',
	);

	assert.equal(permissionMode.source, 'conductor-config');
	assert.equal(permissionMode.value, 'approval-required');
	assert.deepEqual(permissionMode.candidates, [
		{
			reason:
				'Invalid permission mode "sandboxed". Expected one of: workspace-trusted, approval-required, read-only.',
			source: 'ensemble-config',
			status: 'invalid',
		},
		{
			reason: 'Selected by precedence.',
			source: 'conductor-config',
			status: 'selected',
		},
		{
			reason: 'Ignored because conductor-config has higher precedence.',
			source: 'built-in-default',
			status: 'ignored',
		},
	]);
});

test('normalizes IPC settings resolution requests', () => {
	assert.deepEqual(normalizeSettingsResolutionRequest(null), {});
	assert.deepEqual(
		normalizeSettingsResolutionRequest({
			repository: {
				conductorConfig: [],
				ensembleConfig: { scripts: { run: 'bun run dev' } },
				repositoryId: ' repo-1 ',
			},
		}),
		{
			repository: {
				conductorConfig: undefined,
				ensembleConfig: { scripts: { run: 'bun run dev' } },
				repositoryId: 'repo-1',
			},
		},
	);
});
