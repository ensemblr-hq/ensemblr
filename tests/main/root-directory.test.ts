import assert from 'node:assert/strict';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import {
	PIDUCTOR_CONFIG_SCHEMA_VERSION,
	type PiductorConfig,
} from '../../src/main/config/config-loader.ts';
import { resolveSettings } from '../../src/main/config/config-resolution.ts';
import { ensureRootDirectory } from '../../src/main/root/root-directory.ts';
import { openPiductorDatabase } from '../../src/main/storage/database.ts';
import type {
	RootDirectoryDiagnostic,
	RootDirectorySnapshot,
	SettingsResolutionSnapshot,
} from '../../src/shared/ipc.ts';

let settingCounter = 0;

function createConfig(overrides: Partial<PiductorConfig> = {}): PiductorConfig {
	return {
		app: {},
		environment: {},
		managed: {},
		repositoryDefaults: {},
		repositoryRules: [],
		schemaVersion: PIDUCTOR_CONFIG_SCHEMA_VERSION,
		security: {},
		ui: {},
		...overrides,
	};
}

function createDirectoryFixture(t: TestContext): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'piductor-root-'));

	t.after(() => {
		rmSync(directory, { force: true, recursive: true });
	});

	return directory;
}

function createDatabaseFixture(t: TestContext): DatabaseSync {
	const directory = createDirectoryFixture(t);
	const connection = openPiductorDatabase({
		databasePath: path.join(directory, 'piductor-test.db'),
	});

	t.after(() => {
		connection.database.close();
	});

	return connection.database;
}

function createSettingsSnapshot({
	config = createConfig(),
	database = null,
	homeDirectory,
}: {
	config?: PiductorConfig;
	database?: DatabaseSync | null;
	homeDirectory: string;
}): SettingsResolutionSnapshot {
	return resolveSettings({
		config,
		database,
		homeDirectory,
	});
}

function insertAppSetting({
	database,
	key,
	value,
}: {
	database: DatabaseSync;
	key: string;
	value: unknown;
}): void {
	settingCounter += 1;
	database
		.prepare(
			`INSERT INTO settings (id, scope, scope_id, key, value_json)
			 VALUES (?, 'app', '', ?, ?)`,
		)
		.run(`root-setting-${settingCounter}`, key, JSON.stringify(value));
}

function getDiagnostic(
	snapshot: RootDirectorySnapshot,
	code: string,
): RootDirectoryDiagnostic {
	const diagnostic = snapshot.diagnostics.find(
		(candidate) => candidate.code === code,
	);

	if (!diagnostic) {
		assert.fail(`Expected root diagnostic "${code}"`);
	}

	return diagnostic;
}

test('creates the default temp-home root and managed directories', (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const snapshot = ensureRootDirectory({
		homeDirectory,
		settingsSnapshot: createSettingsSnapshot({ homeDirectory }),
	});
	const expectedRoot = path.join(homeDirectory, 'Piductor');

	assert.equal(snapshot.status, 'ok');
	assert.equal(snapshot.path, expectedRoot);
	assert.equal(snapshot.repositoriesPath, path.join(expectedRoot, 'repos'));
	assert.equal(snapshot.workspacesPath, path.join(expectedRoot, 'workspaces'));
	assert.equal(
		snapshot.archivedContextsPath,
		path.join(expectedRoot, 'archived-contexts'),
	);
	assert.deepEqual(
		snapshot.createdPaths.sort(),
		[
			expectedRoot,
			path.join(expectedRoot, 'archived-contexts'),
			path.join(expectedRoot, 'repos'),
			path.join(expectedRoot, 'workspaces'),
		].sort(),
	);
	assert.deepEqual(readdirSync(expectedRoot).sort(), [
		'archived-contexts',
		'repos',
		'workspaces',
	]);
});

test('uses configured root path with source diagnostics from settings resolution', (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const configuredRoot = '~/ConfiguredRoot';
	const snapshot = ensureRootDirectory({
		homeDirectory,
		settingsSnapshot: createSettingsSnapshot({
			config: createConfig({ app: { rootDirectory: configuredRoot } }),
			homeDirectory,
		}),
	});

	assert.equal(snapshot.status, 'ok');
	assert.equal(snapshot.path, path.join(homeDirectory, 'ConfiguredRoot'));
	assert.equal(snapshot.source, 'config-default');
	assert.equal(snapshot.setting?.source, 'config-default');
	assert.equal(
		snapshot.setting?.candidates.some(
			(candidate) =>
				candidate.source === 'config-default' &&
				candidate.status === 'selected',
		),
		true,
	);
});

test('reports a missing root when creation is disabled', (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const snapshot = ensureRootDirectory({
		allowCreate: false,
		homeDirectory,
		settingsSnapshot: createSettingsSnapshot({ homeDirectory }),
	});

	assert.equal(snapshot.status, 'error');
	assert.equal(existsSync(snapshot.path), false);
	assert.equal(getDiagnostic(snapshot, 'root-missing').severity, 'error');
});

test('reports when the root path is occupied by a file', (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const rootFilePath = path.join(homeDirectory, 'root-file');
	writeFileSync(rootFilePath, 'not a directory');

	const snapshot = ensureRootDirectory({
		homeDirectory,
		settingsSnapshot: createSettingsSnapshot({
			config: createConfig({ app: { rootDirectory: rootFilePath } }),
			homeDirectory,
		}),
	});

	assert.equal(snapshot.status, 'error');
	assert.equal(
		getDiagnostic(snapshot, 'root-not-directory').path,
		rootFilePath,
	);
});

test('reports when a managed directory path is occupied by a file', (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const rootPath = path.join(homeDirectory, 'ManagedRoot');
	const reposPath = path.join(rootPath, 'repos');
	mkdirSync(rootPath);
	writeFileSync(reposPath, 'not a directory');

	const snapshot = ensureRootDirectory({
		homeDirectory,
		settingsSnapshot: createSettingsSnapshot({
			config: createConfig({ app: { rootDirectory: rootPath } }),
			homeDirectory,
		}),
	});

	assert.equal(snapshot.status, 'error');
	assert.equal(
		getDiagnostic(snapshot, 'managed-path-not-directory').path,
		reposPath,
	);
	assert.equal(
		snapshot.managedPaths.find((managedPath) => managedPath.key === 'repos')
			?.status,
		'invalid',
	);
});

test('does not modify a root with unsafe unmanaged top-level content', (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const rootPath = path.join(homeDirectory, 'UnsafeRoot');
	mkdirSync(rootPath);
	writeFileSync(path.join(rootPath, 'notes.txt'), 'user content');

	const snapshot = ensureRootDirectory({
		homeDirectory,
		settingsSnapshot: createSettingsSnapshot({
			config: createConfig({ app: { rootDirectory: rootPath } }),
			homeDirectory,
		}),
	});

	assert.equal(snapshot.status, 'error');
	assert.equal(
		getDiagnostic(snapshot, 'unsafe-root-content').severity,
		'error',
	);
	assert.equal(existsSync(path.join(rootPath, 'repos')), false);
	assert.deepEqual(readdirSync(rootPath), ['notes.txt']);
});

test('ignores harmless macOS root metadata when creating managed directories', (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const rootPath = path.join(homeDirectory, 'MetadataRoot');
	mkdirSync(rootPath);
	writeFileSync(path.join(rootPath, '.DS_Store'), 'finder metadata');

	const snapshot = ensureRootDirectory({
		homeDirectory,
		settingsSnapshot: createSettingsSnapshot({
			config: createConfig({ app: { rootDirectory: rootPath } }),
			homeDirectory,
		}),
	});

	assert.equal(snapshot.status, 'ok');
	assert.deepEqual(readdirSync(rootPath).sort(), [
		'.DS_Store',
		'archived-contexts',
		'repos',
		'workspaces',
	]);
});

test('warns about existing managed content as a shared-looking root', (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const rootPath = path.join(homeDirectory, 'SharedRoot');
	const reposPath = path.join(rootPath, 'repos');
	const workspacesPath = path.join(rootPath, 'workspaces');
	const archivedContextsPath = path.join(rootPath, 'archived-contexts');

	mkdirSync(rootPath);
	mkdirSync(reposPath);
	mkdirSync(workspacesPath);
	mkdirSync(archivedContextsPath);
	writeFileSync(path.join(reposPath, 'piductor-marker'), 'repo content');
	writeFileSync(
		path.join(workspacesPath, 'workspace-marker'),
		'workspace content',
	);

	const snapshot = ensureRootDirectory({
		homeDirectory,
		settingsSnapshot: createSettingsSnapshot({
			config: createConfig({ app: { rootDirectory: rootPath } }),
			homeDirectory,
		}),
	});

	assert.equal(snapshot.status, 'warning');
	assert.equal(
		snapshot.diagnostics.filter(
			(diagnostic) => diagnostic.code === 'shared-root-content',
		).length,
		2,
	);
	assert.deepEqual(snapshot.createdPaths, []);
});

test('persists and upserts current root metadata in SQLite', (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const database = createDatabaseFixture(t);
	const firstRoot = path.join(homeDirectory, 'FirstRoot');
	const secondRoot = path.join(homeDirectory, 'SecondRoot');

	insertAppSetting({
		database,
		key: 'rootDirectory',
		value: firstRoot,
	});

	const firstSnapshot = ensureRootDirectory({
		database,
		homeDirectory,
		now: () => new Date('2026-06-04T20:00:00.000Z'),
		settingsSnapshot: createSettingsSnapshot({
			database,
			homeDirectory,
		}),
	});

	assert.equal(firstSnapshot.source, 'sqlite');

	database
		.prepare(
			`UPDATE settings
			 SET value_json = ?
			 WHERE scope = 'app' AND scope_id = '' AND key = 'rootDirectory'`,
		)
		.run(JSON.stringify(secondRoot));

	ensureRootDirectory({
		database,
		homeDirectory,
		now: () => new Date('2026-06-04T20:10:00.000Z'),
		settingsSnapshot: createSettingsSnapshot({
			database,
			homeDirectory,
		}),
	});

	const rows = database
		.prepare(
			`SELECT path, source, status, repositories_path, workspaces_path, archived_contexts_path, last_seen_at, metadata_json
			 FROM root_directories`,
		)
		.all() as Array<{
		archived_contexts_path: string;
		last_seen_at: string;
		metadata_json: string;
		path: string;
		repositories_path: string;
		source: string;
		status: string;
		workspaces_path: string;
	}>;

	assert.equal(rows.length, 1);
	assert.deepEqual(
		{
			archived_contexts_path: rows[0]?.archived_contexts_path,
			last_seen_at: rows[0]?.last_seen_at,
			path: rows[0]?.path,
			repositories_path: rows[0]?.repositories_path,
			source: rows[0]?.source,
			status: rows[0]?.status,
			workspaces_path: rows[0]?.workspaces_path,
		},
		{
			archived_contexts_path: path.join(secondRoot, 'archived-contexts'),
			last_seen_at: '2026-06-04T20:10:00.000Z',
			path: secondRoot,
			repositories_path: path.join(secondRoot, 'repos'),
			source: 'sqlite',
			status: 'ok',
			workspaces_path: path.join(secondRoot, 'workspaces'),
		},
	);
	assert.equal(
		JSON.parse(rows[0]?.metadata_json ?? '{}').setting.source,
		'sqlite',
	);
});

test('rejects relative configured root paths', (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const snapshot = ensureRootDirectory({
		homeDirectory,
		settingsSnapshot: createSettingsSnapshot({
			config: createConfig({ app: { rootDirectory: 'relative/root' } }),
			homeDirectory,
		}),
	});

	assert.equal(snapshot.status, 'error');
	assert.equal(snapshot.path, '');
	assert.equal(
		getDiagnostic(snapshot, 'root-setting-relative').severity,
		'error',
	);
});
