import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getRepositoryWorkspaceNavigationSnapshot } from '../../src/main/ipc/repository-workspace-navigation.ts';
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
	'004_archive_lifecycle',
	'005_pi_session_metadata',
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
		'archive_records',
		'chat_tabs',
		'checkpoints',
		'comments',
		'integration_metadata',
		'pi_runtime_state',
		'pi_session_branches',
		'pi_session_events',
		'pi_sessions',
		'pi_turns',
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

test('migration 005 supports Pi session metadata round-trip', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const connection = openEnsembleDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());
	const { database } = connection;

	database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-pi-1', 'pi-runtime', 'Pi Runtime', '/tmp/ensemble/pi-runtime', 'main');

INSERT INTO workspaces (id, repository_id, slug, name, path, branch_name, base_branch)
VALUES ('ws-pi-1', 'repo-pi-1', 'the-128', 'THE-128', '/tmp/ensemble/workspaces/the-128', 'philipp/the-128', 'main');

INSERT INTO pi_sessions (id, workspace_id, pi_session_id, executable_id, model, status, cwd)
VALUES ('pi-session-1', 'ws-pi-1', 'pi-runtime-session-7', 'pi-default', 'gpt-5.5', 'streaming', '/tmp/ensemble/workspaces/the-128');

INSERT INTO pi_session_branches (id, pi_session_id, kind)
VALUES ('branch-main', 'pi-session-1', 'main');

INSERT INTO pi_turns (id, branch_id, ordinal, prompt_text, status)
VALUES ('turn-0', 'branch-main', 0, 'hello pi', 'completed');

INSERT INTO pi_session_events (id, branch_id, turn_id, ordinal, event_type, stream, payload_json)
VALUES
	('evt-0', 'branch-main', 'turn-0', 0, 'message', 'protocol', '{"role":"user","text":"hello pi"}'),
	('evt-1', 'branch-main', 'turn-0', 1, 'message', 'protocol', '{"role":"agent","text":"hi"}'),
	('evt-stderr', 'branch-main', NULL, 2, 'stderr', 'stderr', '{"line":"warning"}');

INSERT INTO chat_tabs (id, workspace_id, pi_session_id, kind, title, position)
VALUES ('tab-1', 'ws-pi-1', 'pi-session-1', 'chat', 'Chat', 0);

INSERT INTO pi_runtime_state (workspace_id, active_tab_id, last_active_session_id)
VALUES ('ws-pi-1', 'tab-1', 'pi-session-1');
`);

	const counts = database
		.prepare(`
SELECT
	(SELECT COUNT(*) FROM pi_sessions) AS pi_sessions,
	(SELECT COUNT(*) FROM pi_session_branches) AS pi_session_branches,
	(SELECT COUNT(*) FROM pi_turns) AS pi_turns,
	(SELECT COUNT(*) FROM pi_session_events) AS pi_session_events,
	(SELECT COUNT(*) FROM chat_tabs) AS chat_tabs,
	(SELECT COUNT(*) FROM pi_runtime_state) AS pi_runtime_state
`)
		.get() as Record<string, number>;

	assert.deepEqual(
		{ ...counts },
		{
			chat_tabs: 1,
			pi_runtime_state: 1,
			pi_session_branches: 1,
			pi_session_events: 3,
			pi_sessions: 1,
			pi_turns: 1,
		},
	);

	assert.throws(() => {
		database
			.prepare(
				`INSERT INTO pi_turns (id, branch_id, ordinal, prompt_text)
				 VALUES ('turn-dup', 'branch-main', 0, 'duplicate')`,
			)
			.run();
	}, /UNIQUE/i);

	assert.throws(() => {
		database
			.prepare(
				`INSERT INTO pi_session_events (id, branch_id, ordinal, event_type)
				 VALUES ('evt-dup', 'branch-main', 0, 'message')`,
			)
			.run();
	}, /UNIQUE/i);
});

test('migration 005 cascades pi session deletes on workspace removal', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const connection = openEnsembleDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());
	const { database } = connection;

	database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-pi-2', 'pi-runtime-2', 'Pi Runtime 2', '/tmp/ensemble/pi-runtime-2', 'main');

INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('ws-pi-2', 'repo-pi-2', 'the-129', 'THE-129', '/tmp/ensemble/workspaces/the-129');

INSERT INTO pi_sessions (id, workspace_id, status, cwd)
VALUES ('pi-session-2', 'ws-pi-2', 'idle', '/tmp/ensemble/workspaces/the-129');

INSERT INTO pi_session_branches (id, pi_session_id, kind)
VALUES ('branch-cascade', 'pi-session-2', 'main');

INSERT INTO pi_session_events (id, branch_id, ordinal, event_type)
VALUES ('evt-cascade', 'branch-cascade', 0, 'metadata');

INSERT INTO chat_tabs (id, workspace_id, pi_session_id, kind, title)
VALUES ('tab-cascade', 'ws-pi-2', 'pi-session-2', 'chat', 'Chat');
`);

	database.prepare(`DELETE FROM workspaces WHERE id = ?`).run('ws-pi-2');

	const counts = database
		.prepare(`
SELECT
	(SELECT COUNT(*) FROM pi_sessions) AS pi_sessions,
	(SELECT COUNT(*) FROM pi_session_branches) AS pi_session_branches,
	(SELECT COUNT(*) FROM pi_session_events) AS pi_session_events,
	(SELECT COUNT(*) FROM chat_tabs) AS chat_tabs
`)
		.get() as Record<string, number>;

	assert.deepEqual(
		{ ...counts },
		{
			chat_tabs: 0,
			pi_session_branches: 0,
			pi_session_events: 0,
			pi_sessions: 0,
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

test('repository workspace navigation snapshot nests active workspaces', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const connection = openEnsembleDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());

	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch, metadata_json)
VALUES
	('repo-1', 'ensemble', 'Ensemble', '/tmp/ensemble/repo', 'master', '{"owner":"alice","avatarUrl":"https://example.com/avatar.png"}'),
	('repo-2', 'agent-lab', 'Agent Lab', '/tmp/agent-lab/repo', 'main', '{invalid');

INSERT INTO workspaces (
	id,
	repository_id,
	slug,
	name,
	path,
	branch_name,
	base_branch,
	archived_at,
	metadata_json
)
VALUES
	('workspace-1', 'repo-1', 'the-120', 'THE-120', '/tmp/ensemble/workspaces/the-120', 'philipp/the-120', 'master', NULL, '{"linearIssue":"THE-120"}'),
	('workspace-archived', 'repo-1', 'archived', 'Archived', '/tmp/ensemble/workspaces/archived', 'archived', 'master', '2026-06-01T00:00:00.000Z', '{}'),
	('workspace-2', 'repo-2', 'draft', 'Draft', '/tmp/agent-lab/workspaces/draft', NULL, NULL, NULL, '{bad');
`);

	const snapshot = getRepositoryWorkspaceNavigationSnapshot(
		connection.database,
	);

	assert.match(snapshot.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
	assert.equal(snapshot.repositories.length, 2);
	assert.deepEqual(
		snapshot.repositories.map((repository) => repository.id),
		['repo-2', 'repo-1'],
	);
	assert.deepEqual(snapshot.repositories[0]?.metadata, {});
	assert.equal(snapshot.repositories[0]?.workspaces.length, 1);
	assert.deepEqual(snapshot.repositories[0]?.workspaces[0]?.metadata, {});
	assert.equal(snapshot.repositories[1]?.metadata.owner, 'alice');
	assert.deepEqual(
		snapshot.repositories[1]?.workspaces.map((workspace) => workspace.id),
		['workspace-1'],
	);
	assert.equal(
		snapshot.repositories[1]?.workspaces[0]?.metadata.linearIssue,
		'THE-120',
	);
});

test('repository workspace navigation snapshot handles empty database', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const connection = openEnsembleDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());

	const snapshot = getRepositoryWorkspaceNavigationSnapshot(
		connection.database,
	);

	assert.deepEqual(snapshot.repositories, []);
});

test('repository workspace navigation snapshot handles unavailable database', () => {
	const snapshot = getRepositoryWorkspaceNavigationSnapshot(null);

	assert.deepEqual(snapshot.repositories, []);
});
