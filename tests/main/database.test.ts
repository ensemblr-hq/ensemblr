import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	createEnsembleDatabaseService,
	getCurrentSchemaVersion,
	LATEST_SCHEMA_VERSION,
	listAppliedMigrationIds,
	openEnsembleDatabase,
	resolveDefaultDatabasePath,
} from '../../src/main/storage/database.ts';

const EXPECTED_MIGRATIONS = [
	'001_foundation_metadata',
	'002_secret_metadata',
	'003_root_directory_metadata',
];

function createTestDatabasePath(): {
	cleanup: () => void;
	databasePath: string;
} {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemble-db-'));

	return {
		cleanup: () => rmSync(directory, { force: true, recursive: true }),
		databasePath: path.join(directory, 'ensemble-test.db'),
	};
}

test('resolves the macOS app-support database path', () => {
	const databasePath = resolveDefaultDatabasePath('/Users/example');

	if (process.platform === 'darwin') {
		assert.equal(
			databasePath,
			'/Users/example/Library/Application Support/com.ensemble.app/ensemble.db',
		);
		return;
	}

	assert.equal(databasePath, '/Users/example/.config/ensemble/ensemble.db');
});

test('opens an isolated database and applies foundation migrations', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const connection = openEnsembleDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());

	assert.equal(connection.path, fixture.databasePath);
	assert.equal(connection.schemaVersion, LATEST_SCHEMA_VERSION);
	assert.equal(
		getCurrentSchemaVersion(connection.database),
		LATEST_SCHEMA_VERSION,
	);
	assert.deepEqual(
		listAppliedMigrationIds(connection.database),
		EXPECTED_MIGRATIONS,
	);
	assert.equal(existsSync(fixture.databasePath), true);

	const tables = connection.database
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
		)
		.all()
		.map((row) => (row as { name: string }).name);

	assert.deepEqual(tables, [
		'checkpoints',
		'comments',
		'integration_metadata',
		'process_records',
		'repositories',
		'root_directories',
		'schema_migrations',
		'secret_metadata',
		'sessions',
		'settings',
		'terminal_sessions',
		'todos',
		'workspaces',
	]);
});

test('runs migrations idempotently on reopen', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const firstConnection = openEnsembleDatabase({
		databasePath: fixture.databasePath,
	});
	firstConnection.database.close();

	const secondConnection = openEnsembleDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => secondConnection.database.close());

	const migrationRows = secondConnection.database
		.prepare('SELECT COUNT(*) AS count FROM schema_migrations')
		.get() as { count: number };

	assert.equal(migrationRows.count, EXPECTED_MIGRATIONS.length);
	assert.deepEqual(
		listAppliedMigrationIds(secondConnection.database),
		EXPECTED_MIGRATIONS,
	);
	assert.equal(
		getCurrentSchemaVersion(secondConnection.database),
		LATEST_SCHEMA_VERSION,
	);
});

test('enforces foreign keys', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const connection = openEnsembleDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());

	assert.throws(() => {
		connection.database
			.prepare(
				`INSERT INTO workspaces (id, repository_id, slug, name, path)
				 VALUES ('workspace-1', 'missing-repo', 'demo', 'Demo', '/tmp/demo')`,
			)
			.run();
	}, /constraint/i);
});

test('supports basic CRUD fixtures for foundational tables', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const connection = openEnsembleDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());
	const { database } = connection;

	database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-1', 'ensemble', 'Ensemble', '/tmp/ensemble/repo', 'master');

INSERT INTO workspaces (id, repository_id, slug, name, path, branch_name, base_branch)
VALUES ('workspace-1', 'repo-1', 'the-103', 'THE-103', '/tmp/ensemble/workspaces/the-103', 'philipp/the-103', 'master');

INSERT INTO settings (id, scope, scope_id, key, value_json)
VALUES ('setting-1', 'repository', 'repo-1', 'setup.autoRun', 'false');

INSERT INTO sessions (id, workspace_id, title, status)
VALUES ('session-1', 'workspace-1', 'SQLite implementation', 'running');

INSERT INTO terminal_sessions (id, workspace_id, session_id, title, shell, cwd, status)
VALUES ('terminal-1', 'workspace-1', 'session-1', 'Setup', '/bin/zsh', '/tmp/ensemble/repo', 'running');

INSERT INTO checkpoints (id, workspace_id, session_id, git_ref, label)
VALUES ('checkpoint-1', 'workspace-1', 'session-1', 'refs/ensemble/checkpoints/1', 'Before turn');

INSERT INTO comments (id, workspace_id, session_id, checkpoint_id, file_path, line_number, body)
VALUES ('comment-1', 'workspace-1', 'session-1', 'checkpoint-1', 'src/main/storage/database.ts', 42, 'Review note');

INSERT INTO todos (id, workspace_id, session_id, title, position)
VALUES ('todo-1', 'workspace-1', 'session-1', 'Add migrations', 1);

INSERT INTO integration_metadata (id, provider, resource_type, resource_id, external_id, metadata_json)
VALUES ('integration-1', 'linear', 'issue', 'THE-103', 'THE-103', '{"status":"In Progress"}');

INSERT INTO process_records (id, workspace_id, session_id, kind, status, pid, command_label)
VALUES ('process-1', 'workspace-1', 'session-1', 'system', 'running', 1234, 'database smoke test');
`);

	const counts = database
		.prepare(`
SELECT
	(SELECT COUNT(*) FROM repositories) AS repositories,
	(SELECT COUNT(*) FROM workspaces) AS workspaces,
	(SELECT COUNT(*) FROM settings) AS settings,
	(SELECT COUNT(*) FROM sessions) AS sessions,
	(SELECT COUNT(*) FROM terminal_sessions) AS terminal_sessions,
	(SELECT COUNT(*) FROM checkpoints) AS checkpoints,
	(SELECT COUNT(*) FROM comments) AS comments,
	(SELECT COUNT(*) FROM todos) AS todos,
	(SELECT COUNT(*) FROM integration_metadata) AS integration_metadata,
	(SELECT COUNT(*) FROM process_records) AS process_records
`)
		.get() as Record<string, number>;

	assert.deepEqual(
		{ ...counts },
		{
			checkpoints: 1,
			comments: 1,
			integration_metadata: 1,
			process_records: 1,
			repositories: 1,
			sessions: 1,
			settings: 1,
			terminal_sessions: 1,
			todos: 1,
			workspaces: 1,
		},
	);
});

test('stores only secret metadata and keychain references in SQLite', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const connection = openEnsembleDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());

	const rawSecretValue = 'ensemble-raw-secret-value-not-persisted';
	const maskedDisplay = '****sted';

	connection.database
		.prepare(
			`INSERT INTO secret_metadata (
				id,
				scope,
				scope_id,
				name,
				backend,
				service,
				account,
				display_name,
				masked_display,
				character_count,
				metadata_json
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			'secret-1',
			'app',
			'',
			'ENSEMBLE_TEST_SECRET',
			'macos-keychain',
			'com.ensemble.app.secret-store',
			'v1:app::ENSEMBLE_TEST_SECRET',
			'Ensemble test secret',
			maskedDisplay,
			rawSecretValue.length,
			'{"source":"test"}',
		);

	const rows = connection.database
		.prepare('SELECT * FROM secret_metadata')
		.all();

	assert.equal(JSON.stringify(rows).includes(rawSecretValue), false);
	assert.equal(
		(rows[0] as { masked_display: string }).masked_display,
		maskedDisplay,
	);
});

test('schema does not define raw secret value columns', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const connection = openEnsembleDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());

	const columns = connection.database
		.prepare(
			`SELECT m.name AS table_name, p.name AS column_name
			 FROM sqlite_master AS m, pragma_table_info(m.name) AS p
			 WHERE m.type = 'table'
			 ORDER BY m.name, p.cid`,
		)
		.all() as Array<{ column_name: string; table_name: string }>;

	const sensitiveColumns = columns.filter(({ column_name }) =>
		/secret|token|password|credential/i.test(column_name),
	);

	assert.deepEqual(sensitiveColumns, []);
});

test('database service reports health without throwing on open', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const service = createEnsembleDatabaseService({
		databasePath: fixture.databasePath,
	});
	t.after(service.close);

	assert.deepEqual(service.open(), {
		path: fixture.databasePath,
		schemaVersion: LATEST_SCHEMA_VERSION,
		status: 'ok',
	});
	assert.equal(service.getConnection()?.path, fixture.databasePath);
	assert.equal(service.getHealth().status, 'ok');
});
