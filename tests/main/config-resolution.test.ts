import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import {
	ENSEMBLR_CONFIG_SCHEMA_VERSION,
	type EnsemblrConfig,
} from '../../src/main/config/config-loader.ts';
import {
	normalizeSettingsResolutionRequest,
	resolveSettings,
} from '../../src/main/config/config-resolution.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import type {
	ExperimentalSettings,
	GitSettings,
} from '../../src/shared/config/app-settings.ts';
import type { SettingsResolutionGroupSnapshot } from '../../src/shared/ipc/index.ts';

let settingCounter = 0;
const previewUrlTemplate = 'http://localhost:$' + '{ENSEMBLR_PORT}';

function createConfig(overrides: Partial<EnsemblrConfig> = {}): EnsemblrConfig {
	return {
		app: {},
		environment: {},
		managed: {},
		repositoryDefaults: {},
		repositoryRules: [],
		schemaVersion: ENSEMBLR_CONFIG_SCHEMA_VERSION,
		security: {},
		ui: {},
		...overrides,
	};
}

function makeUserGit(overrides: Partial<GitSettings> = {}): GitSettings {
	return {
		branchPrefixSource: 'github-username',
		branchPrefixCustom: '',
		renameWorkspaceOnBranch: true,
		deleteLocalBranchOnArchive: false,
		archiveAfterMerge: false,
		setUpstreamOnPush: true,
		...overrides,
	};
}

function makeUserExperimental(
	overrides: Partial<ExperimentalSettings> = {},
): ExperimentalSettings {
	return {
		autoRunAfterSetup: false,
		...overrides,
	};
}

function createDatabaseFixture(t: TestContext): DatabaseSync {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-resolution-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'ensemblr-test.db'),
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
			value: '/Users/example/Ensemblr',
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

test('.ensemblr/settings.toml outranks personal SQLite per-key', (t) => {
	const database = createDatabaseFixture(t);
	insertSetting({
		database,
		key: 'scripts.run',
		scope: 'repository',
		scopeId: 'repo-1',
		valueJson: JSON.stringify('bun run sqlite'),
	});
	insertSetting({
		database,
		key: 'scripts.setup',
		scope: 'repository',
		scopeId: 'repo-1',
		valueJson: JSON.stringify('bun install sqlite'),
	});

	const snapshot = resolveSettings({
		config: createConfig(),
		database,
		repository: {
			ensemblrConfig: {
				previewUrlTemplate,
				scripts: { run: 'bun run ensemblr' },
			},
			repositoryId: 'repo-1',
		},
	});

	if (!snapshot.repository) {
		assert.fail('Expected repository settings resolution');
	}

	// The committed .ensemblr/settings.toml wins for the keys it defines.
	assert.deepEqual(
		{
			source: getSetting(snapshot.repository, 'scripts.run').source,
			value: getSetting(snapshot.repository, 'scripts.run').value,
		},
		{ source: 'ensemblr-config', value: 'bun run ensemblr' },
	);
	// A key the committed file omits falls back to the personal SQLite edit.
	assert.deepEqual(
		{
			source: getSetting(snapshot.repository, 'scripts.setup').source,
			value: getSetting(snapshot.repository, 'scripts.setup').value,
		},
		{ source: 'sqlite', value: 'bun install sqlite' },
	);
	assert.deepEqual(
		{
			source: getSetting(snapshot.repository, 'previewUrlTemplate').source,
			value: getSetting(snapshot.repository, 'previewUrlTemplate').value,
		},
		{
			source: 'ensemblr-config',
			value: previewUrlTemplate,
		},
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
			source: 'ensemblr-config',
			status: 'selected',
		},
		{
			reason: 'Ignored because ensemblr-config has higher precedence.',
			source: 'sqlite',
			status: 'ignored',
		},
		{
			reason: 'Ignored because ensemblr-config has higher precedence.',
			source: 'built-in-default',
			status: 'ignored',
		},
	]);
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

test('invalid repository permission mode falls back by source precedence', (t) => {
	const database = createDatabaseFixture(t);
	insertSetting({
		database,
		key: 'security.permissionMode',
		scope: 'repository',
		scopeId: 'repo-1',
		valueJson: JSON.stringify('approval-required'),
	});

	const snapshot = resolveSettings({
		config: createConfig(),
		database,
		repository: {
			ensemblrConfig: { security: { permissionMode: 'sandboxed' } },
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

	assert.equal(permissionMode.source, 'sqlite');
	assert.equal(permissionMode.value, 'approval-required');
	assert.deepEqual(permissionMode.candidates, [
		{
			reason:
				'Invalid permission mode "sandboxed". Expected one of: workspace-trusted, approval-required, read-only.',
			source: 'ensemblr-config',
			status: 'invalid',
		},
		{
			reason: 'Selected by precedence.',
			source: 'sqlite',
			status: 'selected',
		},
		{
			reason: 'Ignored because sqlite has higher precedence.',
			source: 'built-in-default',
			status: 'ignored',
		},
	]);
});

test('user-default settings apply when no repo source sets them', () => {
	const snapshot = resolveSettings({
		config: createConfig(),
		repository: { repositoryId: 'repo-1' },
		userExperimentalDefaults: makeUserExperimental({
			autoRunAfterSetup: true,
		}),
		userGitDefaults: makeUserGit({
			archiveAfterMerge: true,
			deleteLocalBranchOnArchive: true,
			setUpstreamOnPush: false,
		}),
	});

	if (!snapshot.repository) {
		assert.fail('Expected repository settings resolution');
	}

	// Wins over the built-in default (false) because user-default ranks higher.
	assert.deepEqual(
		{
			source: getSetting(snapshot.repository, 'deleteLocalBranchOnArchive')
				.source,
			value: getSetting(snapshot.repository, 'deleteLocalBranchOnArchive')
				.value,
		},
		{ source: 'user-default', value: true },
	);
	assert.deepEqual(
		{
			source: getSetting(snapshot.repository, 'archiveAfterMerge').source,
			value: getSetting(snapshot.repository, 'archiveAfterMerge').value,
		},
		{ source: 'user-default', value: true },
	);
	assert.deepEqual(
		{
			source: getSetting(snapshot.repository, 'autoRunAfterSetup').source,
			value: getSetting(snapshot.repository, 'autoRunAfterSetup').value,
		},
		{ source: 'user-default', value: true },
	);
	// setUpstreamOnPush has no built-in default — user-default is the only source.
	assert.deepEqual(
		{
			source: getSetting(snapshot.repository, 'setUpstreamOnPush').source,
			value: getSetting(snapshot.repository, 'setUpstreamOnPush').value,
		},
		{ source: 'user-default', value: false },
	);
});

test('repository sources override user-default settings', () => {
	const snapshot = resolveSettings({
		config: createConfig(),
		repository: {
			ensemblrConfig: {
				archiveAfterMerge: false,
				autoRunAfterSetup: false,
			},
			repositoryId: 'repo-1',
		},
		userExperimentalDefaults: makeUserExperimental({
			autoRunAfterSetup: true,
		}),
		userGitDefaults: makeUserGit({ archiveAfterMerge: true }),
	});

	if (!snapshot.repository) {
		assert.fail('Expected repository settings resolution');
	}

	const archiveAfterMerge = getSetting(
		snapshot.repository,
		'archiveAfterMerge',
	);
	assert.equal(archiveAfterMerge.source, 'ensemblr-config');
	assert.equal(archiveAfterMerge.value, false);
	assert.deepEqual(archiveAfterMerge.candidates, [
		{
			reason: 'Selected by precedence.',
			source: 'ensemblr-config',
			status: 'selected',
		},
		{
			reason: 'Ignored because ensemblr-config has higher precedence.',
			source: 'user-default',
			status: 'ignored',
		},
		{
			reason: 'Ignored because ensemblr-config has higher precedence.',
			source: 'built-in-default',
			status: 'ignored',
		},
	]);

	const autoRunAfterSetup = getSetting(
		snapshot.repository,
		'autoRunAfterSetup',
	);
	assert.equal(autoRunAfterSetup.source, 'ensemblr-config');
	assert.equal(autoRunAfterSetup.value, false);
});

test('normalizes IPC settings resolution requests', () => {
	assert.deepEqual(normalizeSettingsResolutionRequest(null), {});
	assert.deepEqual(
		normalizeSettingsResolutionRequest({
			repository: {
				ensemblrConfig: { scripts: { run: 'bun run dev' } },
				repositoryId: ' repo-1 ',
			},
		}),
		{
			repository: {
				ensemblrConfig: { scripts: { run: 'bun run dev' } },
				repositoryId: 'repo-1',
			},
		},
	);
});
