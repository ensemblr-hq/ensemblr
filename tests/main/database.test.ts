import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { getRepositoryWorkspaceNavigationSnapshot } from '../../src/main/ipc/repository-workspace-navigation.ts';
import {
	createEnsemblrDatabaseService,
	getCurrentSchemaVersion,
	LATEST_SCHEMA_VERSION,
	listAppliedMigrationIds,
	openEnsemblrDatabase,
	resolveDefaultDatabasePath,
} from '../../src/main/storage/database.ts';

const EXPECTED_MIGRATIONS = [
	'001_foundation_metadata',
	'002_secret_metadata',
	'003_root_directory_metadata',
	'004_archive_lifecycle',
	'005_pi_session_metadata',
	'006_repository_remote_url_index',
	'007_chat_tab_kinds',
	'008_checkpoint_pi_linkage',
	'009_linear_cache',
	'010_chat_tab_terminal_kind',
	'011_chat_tab_full_title',
	'012_comment_origin',
	'013_pi_session_provider',
	'014_agent_session_vocabulary',
	'015_untitled_chat_tab_placeholder',
];

const AGENT_VOCABULARY_MIGRATION_VERSION = 14;
const PRE_AGENT_VOCABULARY_SCHEMA_VERSION = 13;

// Staging a pre-014 database means suppressing 014 *and* everything appended
// after it, or the newer migrations run against the old schema and the fixture
// is no longer pre-014. Ids are numbered in order, so the index is the version.
const SUPPRESSED_MIGRATIONS = EXPECTED_MIGRATIONS.slice(
	AGENT_VOCABULARY_MIGRATION_VERSION - 1,
).map((id, offset) => ({
	id,
	version: AGENT_VOCABULARY_MIGRATION_VERSION + offset,
}));

const PRE_AGENT_VOCABULARY_SEED_SQL = `
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-upgrade', 'upgrade', 'Upgrade', '/tmp/ensemblr/upgrade', 'main');

INSERT INTO workspaces (id, repository_id, slug, name, path, branch_name, base_branch)
VALUES ('ws-upgrade', 'repo-upgrade', 'the-130', 'THE-130', '/tmp/ensemblr/workspaces/the-130', 'philipp/the-130', 'main');

INSERT INTO pi_sessions (
	id, workspace_id, pi_session_id, executable_id, executable_path, model,
	thinking_level, status, last_error, cwd, label, closed_at, metadata_json
)
VALUES
	('pi-session-1', 'ws-upgrade', 'runtime-session-42', 'pi-default', '/usr/local/bin/pi', 'gpt-5.5', 'high', 'streaming', NULL, '/tmp/ensemblr/workspaces/the-130', 'Main chat', NULL, '{"seeded":"one"}'),
	('pi-session-2', 'ws-upgrade', NULL, NULL, NULL, NULL, NULL, 'closed', 'spawn failed', '/tmp/ensemblr/workspaces/the-130', NULL, '2026-06-01T00:00:00.000Z', '{}');

INSERT INTO pi_session_branches (id, pi_session_id, parent_branch_id, forked_from_turn_id, kind, label, metadata_json)
VALUES
	('branch-main', 'pi-session-1', NULL, NULL, 'main', 'Main', '{"branch":"main"}'),
	('branch-fork', 'pi-session-1', 'branch-main', 'turn-0', 'fork', 'Fork', '{"branch":"fork"}');

INSERT INTO pi_turns (id, branch_id, ordinal, status, prompt_text, model, thinking_level, completed_at, turn_metadata_json)
VALUES
	('turn-0', 'branch-main', 0, 'completed', 'first prompt', 'gpt-5.5', 'high', '2026-06-01T00:00:01.000Z', '{"turn":0}'),
	('turn-1', 'branch-main', 1, 'streaming', 'second prompt', 'gpt-5.5', 'medium', NULL, '{"turn":1}');

INSERT INTO pi_session_events (id, branch_id, turn_id, ordinal, event_type, stream, payload_json)
VALUES
	('evt-0', 'branch-main', 'turn-0', 0, 'message', 'protocol', '{"role":"user"}'),
	('evt-1', 'branch-main', 'turn-0', 1, 'message', 'protocol', '{"role":"agent"}'),
	('evt-2', 'branch-main', NULL, 2, 'stderr', 'stderr', '{"line":"warning"}');

INSERT INTO chat_tabs (id, workspace_id, pi_session_id, kind, title, position, closed_at, metadata_json, full_title)
VALUES
	('tab-chat', 'ws-upgrade', 'pi-session-1', 'chat', 'Chat', 0, NULL, '{"tab":"chat"}', 'Chat with the agent'),
	('tab-terminal', 'ws-upgrade', NULL, 'terminal', 'Terminal', 1, NULL, '{"tab":"terminal"}', 'Terminal');

INSERT INTO checkpoints (id, workspace_id, session_id, pi_session_id, turn_id, git_ref, label, reason, git_hash, metadata_json)
VALUES ('checkpoint-1', 'ws-upgrade', NULL, 'pi-session-1', 'turn-0', 'refs/ensemblr/checkpoints/1', 'Before turn 0', 'turn-start', 'abc1234', '{"checkpoint":1}');

INSERT INTO pi_runtime_state (workspace_id, active_tab_id, last_active_session_id)
VALUES ('ws-upgrade', 'tab-chat', 'pi-session-1');
`;

function createTestDatabasePath(): {
	cleanup: () => void;
	databasePath: string;
} {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-db-'));

	return {
		cleanup: () => rmSync(directory, { force: true, recursive: true }),
		databasePath: path.join(directory, 'ensemblr-test.db'),
	};
}

/**
 * Builds a database at the pre-014 `pi_*` schema by running the real migration
 * runner with `014_agent_session_vocabulary` and every later migration
 * pre-recorded as already applied, so migrations 001-013 run and the rest are
 * skipped. There is no version argument on the runner, and `schema_migrations`
 * is the only seam that selects which migrations execute.
 */
function openDatabaseBeforeAgentVocabulary(databasePath: string) {
	const markerConnection = new DatabaseSync(databasePath);
	listAppliedMigrationIds(markerConnection);
	const insertMarker = markerConnection.prepare(
		'INSERT INTO schema_migrations (id, version, name) VALUES (?, ?, ?)',
	);
	for (const migration of SUPPRESSED_MIGRATIONS) {
		insertMarker.run(migration.id, migration.version, migration.id);
	}
	markerConnection.close();

	return openEnsemblrDatabase({ databasePath });
}

/**
 * Leaves a closed database holding real pre-014 rows and no record of migration
 * 014 or anything after it, so the next {@link openEnsemblrDatabase} call
 * applies exactly that tail in order.
 */
function seedDatabaseBeforeAgentVocabulary(databasePath: string): void {
	const connection = openDatabaseBeforeAgentVocabulary(databasePath);

	connection.database.exec(PRE_AGENT_VOCABULARY_SEED_SQL);
	const deleteMarker = connection.database.prepare(
		'DELETE FROM schema_migrations WHERE id = ?',
	);
	for (const migration of SUPPRESSED_MIGRATIONS) {
		deleteMarker.run(migration.id);
	}
	connection.database.close();
}

function readRows(
	database: DatabaseSync,
	sql: string,
	...parameters: string[]
): Array<Record<string, unknown>> {
	return database
		.prepare(sql)
		.all(...parameters)
		.map((row) => ({ ...(row as Record<string, unknown>) }));
}

function listTablesLike(database: DatabaseSync, pattern: string): string[] {
	return readRows(
		database,
		`SELECT name FROM sqlite_master
		 WHERE type = 'table' AND name LIKE ? ESCAPE '\\'
		 ORDER BY name`,
		pattern,
	).map((row) => row.name as string);
}

function listForeignKeys(
	database: DatabaseSync,
	tableName: string,
): Array<Record<string, unknown>> {
	return readRows(
		database,
		`SELECT "from" AS source_column, "table" AS target_table, on_delete
		 FROM pragma_foreign_key_list(?)
		 ORDER BY "from"`,
		tableName,
	);
}

function countAgentRows(database: DatabaseSync): Record<string, number> {
	const row = database
		.prepare(`
SELECT
	(SELECT COUNT(*) FROM agent_sessions) AS agent_sessions,
	(SELECT COUNT(*) FROM agent_session_branches) AS agent_session_branches,
	(SELECT COUNT(*) FROM agent_turns) AS agent_turns,
	(SELECT COUNT(*) FROM agent_session_events) AS agent_session_events,
	(SELECT COUNT(*) FROM agent_runtime_state) AS agent_runtime_state,
	(SELECT COUNT(*) FROM chat_tabs) AS chat_tabs,
	(SELECT COUNT(*) FROM checkpoints) AS checkpoints
`)
		.get() as Record<string, number>;

	return { ...row };
}

test('resolves the macOS app-support database path', () => {
	const databasePath = resolveDefaultDatabasePath('/Users/example');

	if (process.platform === 'darwin') {
		assert.equal(
			databasePath,
			'/Users/example/Library/Application Support/dev.ensemblr.app/ensemblr.db',
		);
		return;
	}

	assert.equal(databasePath, '/Users/example/.config/ensemblr/ensemblr.db');
});

test('opens an isolated database and applies foundation migrations', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const connection = openEnsemblrDatabase({
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
		'agent_runtime_state',
		'agent_session_branches',
		'agent_session_events',
		'agent_sessions',
		'agent_turns',
		'archive_records',
		'chat_tabs',
		'checkpoints',
		'comments',
		'integration_metadata',
		'linear_comments',
		'linear_issues',
		'linear_resources',
		'linear_sync_state',
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

test('gives every comment an author, defaulting rows that predate the column', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const connection = openEnsemblrDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());

	const columns = connection.database
		.prepare('PRAGMA table_info(comments)')
		.all()
		.map((row) => (row as { name: string }).name);
	assert.equal(columns.includes('origin'), true);

	connection.database.exec(`
		INSERT INTO repositories (id, slug, name, path) VALUES ('r-1', 'r', 'R', '/r');
		INSERT INTO workspaces (id, repository_id, slug, name, path) VALUES ('w-1', 'r-1', 'w', 'W', '/w');
		INSERT INTO comments (id, workspace_id, file_path, body) VALUES ('c-1', 'w-1', 'a.ts', 'note');
	`);
	const row = connection.database
		.prepare('SELECT origin FROM comments WHERE id = ?')
		.get('c-1') as { origin: string };
	assert.equal(row.origin, 'user');
});

test('runs migrations idempotently on reopen', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const firstConnection = openEnsemblrDatabase({
		databasePath: fixture.databasePath,
	});
	firstConnection.database.close();

	const secondConnection = openEnsemblrDatabase({
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

	const connection = openEnsemblrDatabase({
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

	const connection = openEnsemblrDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());
	const { database } = connection;

	database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-1', 'ensemblr', 'Ensemblr', '/tmp/ensemblr/repo', 'master');

INSERT INTO workspaces (id, repository_id, slug, name, path, branch_name, base_branch)
VALUES ('workspace-1', 'repo-1', 'the-103', 'THE-103', '/tmp/ensemblr/workspaces/the-103', 'philipp/the-103', 'master');

INSERT INTO settings (id, scope, scope_id, key, value_json)
VALUES ('setting-1', 'repository', 'repo-1', 'setup.autoRun', 'false');

INSERT INTO sessions (id, workspace_id, title, status)
VALUES ('session-1', 'workspace-1', 'SQLite implementation', 'running');

INSERT INTO terminal_sessions (id, workspace_id, session_id, title, shell, cwd, status)
VALUES ('terminal-1', 'workspace-1', 'session-1', 'Setup', '/bin/zsh', '/tmp/ensemblr/repo', 'running');

INSERT INTO checkpoints (id, workspace_id, session_id, git_ref, label)
VALUES ('checkpoint-1', 'workspace-1', 'session-1', 'refs/ensemblr/checkpoints/1', 'Before turn');

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

test('supports an agent session metadata round-trip', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const connection = openEnsemblrDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());
	const { database } = connection;

	database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-agent-1', 'agent-runtime', 'Agent Runtime', '/tmp/ensemblr/agent-runtime', 'main');

INSERT INTO workspaces (id, repository_id, slug, name, path, branch_name, base_branch)
VALUES ('ws-agent-1', 'repo-agent-1', 'the-128', 'THE-128', '/tmp/ensemblr/workspaces/the-128', 'philipp/the-128', 'main');

INSERT INTO agent_sessions (id, workspace_id, runtime_session_id, executable_id, model, status, cwd)
VALUES ('agent-session-1', 'ws-agent-1', 'agent-runtime-session-7', 'pi-default', 'gpt-5.5', 'streaming', '/tmp/ensemblr/workspaces/the-128');

INSERT INTO agent_session_branches (id, agent_session_id, kind)
VALUES ('branch-main', 'agent-session-1', 'main');

INSERT INTO agent_turns (id, branch_id, ordinal, prompt_text, status)
VALUES ('turn-0', 'branch-main', 0, 'hello agent', 'completed');

INSERT INTO agent_session_events (id, branch_id, turn_id, ordinal, event_type, stream, payload_json)
VALUES
	('evt-0', 'branch-main', 'turn-0', 0, 'message', 'protocol', '{"role":"user","text":"hello agent"}'),
	('evt-1', 'branch-main', 'turn-0', 1, 'message', 'protocol', '{"role":"agent","text":"hi"}'),
	('evt-stderr', 'branch-main', NULL, 2, 'stderr', 'stderr', '{"line":"warning"}');

INSERT INTO chat_tabs (id, workspace_id, agent_session_id, kind, title, position)
VALUES ('tab-1', 'ws-agent-1', 'agent-session-1', 'chat', 'Chat', 0);

INSERT INTO agent_runtime_state (workspace_id, active_tab_id, last_active_session_id)
VALUES ('ws-agent-1', 'tab-1', 'agent-session-1');
`);

	const counts = database
		.prepare(`
SELECT
	(SELECT COUNT(*) FROM agent_sessions) AS agent_sessions,
	(SELECT COUNT(*) FROM agent_session_branches) AS agent_session_branches,
	(SELECT COUNT(*) FROM agent_turns) AS agent_turns,
	(SELECT COUNT(*) FROM agent_session_events) AS agent_session_events,
	(SELECT COUNT(*) FROM chat_tabs) AS chat_tabs,
	(SELECT COUNT(*) FROM agent_runtime_state) AS agent_runtime_state
`)
		.get() as Record<string, number>;

	assert.deepEqual(
		{ ...counts },
		{
			agent_runtime_state: 1,
			agent_session_branches: 1,
			agent_session_events: 3,
			agent_sessions: 1,
			agent_turns: 1,
			chat_tabs: 1,
		},
	);

	assert.throws(() => {
		database
			.prepare(
				`INSERT INTO agent_turns (id, branch_id, ordinal, prompt_text)
				 VALUES ('turn-dup', 'branch-main', 0, 'duplicate')`,
			)
			.run();
	}, /UNIQUE/i);

	assert.throws(() => {
		database
			.prepare(
				`INSERT INTO agent_session_events (id, branch_id, ordinal, event_type)
				 VALUES ('evt-dup', 'branch-main', 0, 'message')`,
			)
			.run();
	}, /UNIQUE/i);
});

test('cascades agent session deletes on workspace removal', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const connection = openEnsemblrDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());
	const { database } = connection;

	database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-agent-2', 'agent-runtime-2', 'Agent Runtime 2', '/tmp/ensemblr/agent-runtime-2', 'main');

INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('ws-agent-2', 'repo-agent-2', 'the-129', 'THE-129', '/tmp/ensemblr/workspaces/the-129');

INSERT INTO agent_sessions (id, workspace_id, status, cwd)
VALUES ('agent-session-2', 'ws-agent-2', 'idle', '/tmp/ensemblr/workspaces/the-129');

INSERT INTO agent_session_branches (id, agent_session_id, kind)
VALUES ('branch-cascade', 'agent-session-2', 'main');

INSERT INTO agent_session_events (id, branch_id, ordinal, event_type)
VALUES ('evt-cascade', 'branch-cascade', 0, 'metadata');

INSERT INTO chat_tabs (id, workspace_id, agent_session_id, kind, title)
VALUES ('tab-cascade', 'ws-agent-2', 'agent-session-2', 'chat', 'Chat');
`);

	database.prepare(`DELETE FROM workspaces WHERE id = ?`).run('ws-agent-2');

	const counts = database
		.prepare(`
SELECT
	(SELECT COUNT(*) FROM agent_sessions) AS agent_sessions,
	(SELECT COUNT(*) FROM agent_session_branches) AS agent_session_branches,
	(SELECT COUNT(*) FROM agent_session_events) AS agent_session_events,
	(SELECT COUNT(*) FROM chat_tabs) AS chat_tabs
`)
		.get() as Record<string, number>;

	assert.deepEqual(
		{ ...counts },
		{
			agent_session_branches: 0,
			agent_session_events: 0,
			agent_sessions: 0,
			chat_tabs: 0,
		},
	);
});

test('stages an upgrade fixture at the pre-014 pi_* schema', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const connection = openDatabaseBeforeAgentVocabulary(fixture.databasePath);
	t.after(() => connection.database.close());

	assert.equal(
		getCurrentSchemaVersion(connection.database),
		PRE_AGENT_VOCABULARY_SCHEMA_VERSION,
	);
	assert.deepEqual(listTablesLike(connection.database, 'pi\\_%'), [
		'pi_runtime_state',
		'pi_session_branches',
		'pi_session_events',
		'pi_sessions',
		'pi_turns',
	]);
	assert.deepEqual(listTablesLike(connection.database, 'agent\\_%'), []);
});

test('migration 014 carries pre-existing pi_* rows into the agent_* tables', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);
	seedDatabaseBeforeAgentVocabulary(fixture.databasePath);

	const connection = openEnsemblrDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());
	const { database } = connection;

	assert.equal(connection.schemaVersion, LATEST_SCHEMA_VERSION);
	assert.deepEqual(listAppliedMigrationIds(database), EXPECTED_MIGRATIONS);
	assert.deepEqual(listTablesLike(database, 'pi\\_%'), []);
	assert.deepEqual(countAgentRows(database), {
		agent_runtime_state: 1,
		agent_session_branches: 2,
		agent_session_events: 3,
		agent_sessions: 2,
		agent_turns: 2,
		chat_tabs: 2,
		checkpoints: 1,
	});

	assert.deepEqual(
		readRows(
			database,
			`SELECT id, workspace_id, runtime_session_id, executable_id, executable_path,
				model, thinking_level, status, last_error, cwd, label, closed_at,
				metadata_json, provider
			 FROM agent_sessions ORDER BY id`,
		),
		[
			{
				closed_at: null,
				cwd: '/tmp/ensemblr/workspaces/the-130',
				executable_id: 'pi-default',
				executable_path: '/usr/local/bin/pi',
				id: 'pi-session-1',
				label: 'Main chat',
				last_error: null,
				metadata_json: '{"seeded":"one"}',
				model: 'gpt-5.5',
				provider: 'pi',
				runtime_session_id: 'runtime-session-42',
				status: 'streaming',
				thinking_level: 'high',
				workspace_id: 'ws-upgrade',
			},
			{
				closed_at: '2026-06-01T00:00:00.000Z',
				cwd: '/tmp/ensemblr/workspaces/the-130',
				executable_id: null,
				executable_path: null,
				id: 'pi-session-2',
				label: null,
				last_error: 'spawn failed',
				metadata_json: '{}',
				model: null,
				provider: 'pi',
				runtime_session_id: null,
				status: 'closed',
				thinking_level: null,
				workspace_id: 'ws-upgrade',
			},
		],
	);

	assert.deepEqual(
		readRows(
			database,
			`SELECT id, agent_session_id, parent_branch_id, forked_from_turn_id, kind,
				label, metadata_json
			 FROM agent_session_branches ORDER BY id`,
		),
		[
			{
				agent_session_id: 'pi-session-1',
				forked_from_turn_id: 'turn-0',
				id: 'branch-fork',
				kind: 'fork',
				label: 'Fork',
				metadata_json: '{"branch":"fork"}',
				parent_branch_id: 'branch-main',
			},
			{
				agent_session_id: 'pi-session-1',
				forked_from_turn_id: null,
				id: 'branch-main',
				kind: 'main',
				label: 'Main',
				metadata_json: '{"branch":"main"}',
				parent_branch_id: null,
			},
		],
	);

	assert.deepEqual(
		readRows(
			database,
			`SELECT id, branch_id, ordinal, status, prompt_text, model, thinking_level,
				completed_at, turn_metadata_json
			 FROM agent_turns ORDER BY ordinal`,
		),
		[
			{
				branch_id: 'branch-main',
				completed_at: '2026-06-01T00:00:01.000Z',
				id: 'turn-0',
				model: 'gpt-5.5',
				ordinal: 0,
				prompt_text: 'first prompt',
				status: 'completed',
				thinking_level: 'high',
				turn_metadata_json: '{"turn":0}',
			},
			{
				branch_id: 'branch-main',
				completed_at: null,
				id: 'turn-1',
				model: 'gpt-5.5',
				ordinal: 1,
				prompt_text: 'second prompt',
				status: 'streaming',
				thinking_level: 'medium',
				turn_metadata_json: '{"turn":1}',
			},
		],
	);

	assert.deepEqual(
		readRows(
			database,
			`SELECT id, branch_id, turn_id, ordinal, event_type, stream, payload_json
			 FROM agent_session_events ORDER BY ordinal`,
		),
		[
			{
				branch_id: 'branch-main',
				event_type: 'message',
				id: 'evt-0',
				ordinal: 0,
				payload_json: '{"role":"user"}',
				stream: 'protocol',
				turn_id: 'turn-0',
			},
			{
				branch_id: 'branch-main',
				event_type: 'message',
				id: 'evt-1',
				ordinal: 1,
				payload_json: '{"role":"agent"}',
				stream: 'protocol',
				turn_id: 'turn-0',
			},
			{
				branch_id: 'branch-main',
				event_type: 'stderr',
				id: 'evt-2',
				ordinal: 2,
				payload_json: '{"line":"warning"}',
				stream: 'stderr',
				turn_id: null,
			},
		],
	);

	assert.deepEqual(
		readRows(
			database,
			`SELECT id, workspace_id, agent_session_id, kind, title, position, closed_at,
				metadata_json, full_title
			 FROM chat_tabs ORDER BY position`,
		),
		[
			{
				agent_session_id: 'pi-session-1',
				closed_at: null,
				full_title: 'Chat with the agent',
				id: 'tab-chat',
				kind: 'chat',
				metadata_json: '{"tab":"chat"}',
				position: 0,
				title: 'Chat',
				workspace_id: 'ws-upgrade',
			},
			{
				agent_session_id: null,
				closed_at: null,
				full_title: 'Terminal',
				id: 'tab-terminal',
				kind: 'terminal',
				metadata_json: '{"tab":"terminal"}',
				position: 1,
				title: 'Terminal',
				workspace_id: 'ws-upgrade',
			},
		],
	);

	assert.deepEqual(
		readRows(
			database,
			`SELECT id, workspace_id, session_id, agent_session_id, turn_id, git_ref,
				label, reason, git_hash, metadata_json
			 FROM checkpoints ORDER BY id`,
		),
		[
			{
				agent_session_id: 'pi-session-1',
				git_hash: 'abc1234',
				git_ref: 'refs/ensemblr/checkpoints/1',
				id: 'checkpoint-1',
				label: 'Before turn 0',
				metadata_json: '{"checkpoint":1}',
				reason: 'turn-start',
				session_id: null,
				turn_id: 'turn-0',
				workspace_id: 'ws-upgrade',
			},
		],
	);

	assert.deepEqual(
		readRows(
			database,
			'SELECT workspace_id, active_tab_id, last_active_session_id FROM agent_runtime_state',
		),
		[
			{
				active_tab_id: 'tab-chat',
				last_active_session_id: 'pi-session-1',
				workspace_id: 'ws-upgrade',
			},
		],
	);
});

test('migration 014 repoints foreign keys at the renamed agent_* tables', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);
	seedDatabaseBeforeAgentVocabulary(fixture.databasePath);

	const connection = openEnsemblrDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());
	const { database } = connection;

	assert.deepEqual(readRows(database, 'PRAGMA foreign_key_check'), []);

	assert.deepEqual(
		{
			agent_runtime_state: listForeignKeys(database, 'agent_runtime_state'),
			agent_session_branches: listForeignKeys(
				database,
				'agent_session_branches',
			),
			agent_session_events: listForeignKeys(database, 'agent_session_events'),
			agent_sessions: listForeignKeys(database, 'agent_sessions'),
			agent_turns: listForeignKeys(database, 'agent_turns'),
			chat_tabs: listForeignKeys(database, 'chat_tabs'),
			checkpoints: listForeignKeys(database, 'checkpoints'),
		},
		{
			agent_runtime_state: [
				{
					on_delete: 'SET NULL',
					source_column: 'active_tab_id',
					target_table: 'chat_tabs',
				},
				{
					on_delete: 'SET NULL',
					source_column: 'last_active_session_id',
					target_table: 'agent_sessions',
				},
				{
					on_delete: 'CASCADE',
					source_column: 'workspace_id',
					target_table: 'workspaces',
				},
			],
			agent_session_branches: [
				{
					on_delete: 'CASCADE',
					source_column: 'agent_session_id',
					target_table: 'agent_sessions',
				},
				{
					on_delete: 'SET NULL',
					source_column: 'parent_branch_id',
					target_table: 'agent_session_branches',
				},
			],
			agent_session_events: [
				{
					on_delete: 'CASCADE',
					source_column: 'branch_id',
					target_table: 'agent_session_branches',
				},
				{
					on_delete: 'SET NULL',
					source_column: 'turn_id',
					target_table: 'agent_turns',
				},
			],
			agent_sessions: [
				{
					on_delete: 'CASCADE',
					source_column: 'workspace_id',
					target_table: 'workspaces',
				},
			],
			agent_turns: [
				{
					on_delete: 'CASCADE',
					source_column: 'branch_id',
					target_table: 'agent_session_branches',
				},
			],
			chat_tabs: [
				{
					on_delete: 'SET NULL',
					source_column: 'agent_session_id',
					target_table: 'agent_sessions',
				},
				{
					on_delete: 'CASCADE',
					source_column: 'workspace_id',
					target_table: 'workspaces',
				},
			],
			checkpoints: [
				{
					on_delete: 'SET NULL',
					source_column: 'agent_session_id',
					target_table: 'agent_sessions',
				},
				{
					on_delete: 'SET NULL',
					source_column: 'session_id',
					target_table: 'sessions',
				},
				{
					on_delete: 'SET NULL',
					source_column: 'turn_id',
					target_table: 'agent_turns',
				},
				{
					on_delete: 'CASCADE',
					source_column: 'workspace_id',
					target_table: 'workspaces',
				},
			],
		},
	);
});

test('migration 014 keeps cascade and set-null behaviour on upgraded rows', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);
	seedDatabaseBeforeAgentVocabulary(fixture.databasePath);

	const connection = openEnsemblrDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());
	const { database } = connection;

	database
		.prepare('DELETE FROM agent_session_branches WHERE id = ?')
		.run('branch-main');

	assert.deepEqual(countAgentRows(database), {
		agent_runtime_state: 1,
		agent_session_branches: 1,
		agent_session_events: 0,
		agent_sessions: 2,
		agent_turns: 0,
		chat_tabs: 2,
		checkpoints: 1,
	});
	assert.deepEqual(
		readRows(
			database,
			'SELECT id, parent_branch_id FROM agent_session_branches',
		),
		[{ id: 'branch-fork', parent_branch_id: null }],
	);
	assert.deepEqual(
		readRows(
			database,
			'SELECT turn_id FROM checkpoints WHERE id = ?',
			'checkpoint-1',
		),
		[{ turn_id: null }],
	);

	database
		.prepare('DELETE FROM agent_sessions WHERE id = ?')
		.run('pi-session-1');

	assert.deepEqual(countAgentRows(database), {
		agent_runtime_state: 1,
		agent_session_branches: 0,
		agent_session_events: 0,
		agent_sessions: 1,
		agent_turns: 0,
		chat_tabs: 2,
		checkpoints: 1,
	});
	assert.deepEqual(
		readRows(
			database,
			'SELECT agent_session_id FROM chat_tabs WHERE id = ?',
			'tab-chat',
		),
		[{ agent_session_id: null }],
	);
	assert.deepEqual(
		readRows(
			database,
			'SELECT agent_session_id FROM checkpoints WHERE id = ?',
			'checkpoint-1',
		),
		[{ agent_session_id: null }],
	);
	assert.deepEqual(
		readRows(
			database,
			'SELECT active_tab_id, last_active_session_id FROM agent_runtime_state',
		),
		[{ active_tab_id: 'tab-chat', last_active_session_id: null }],
	);

	database.prepare('DELETE FROM chat_tabs WHERE id = ?').run('tab-chat');

	assert.deepEqual(
		readRows(database, 'SELECT active_tab_id FROM agent_runtime_state'),
		[{ active_tab_id: null }],
	);

	database.prepare('DELETE FROM workspaces WHERE id = ?').run('ws-upgrade');

	assert.deepEqual(countAgentRows(database), {
		agent_runtime_state: 0,
		agent_session_branches: 0,
		agent_session_events: 0,
		agent_sessions: 0,
		agent_turns: 0,
		chat_tabs: 0,
		checkpoints: 0,
	});
	assert.deepEqual(readRows(database, 'PRAGMA foreign_key_check'), []);
});

test('a database upgraded through migration 014 matches one created from scratch', (t) => {
	const upgradedFixture = createTestDatabasePath();
	t.after(upgradedFixture.cleanup);
	seedDatabaseBeforeAgentVocabulary(upgradedFixture.databasePath);

	const upgradedConnection = openEnsemblrDatabase({
		databasePath: upgradedFixture.databasePath,
	});
	t.after(() => upgradedConnection.database.close());

	const freshFixture = createTestDatabasePath();
	t.after(freshFixture.cleanup);

	const freshConnection = openEnsemblrDatabase({
		databasePath: freshFixture.databasePath,
	});
	t.after(() => freshConnection.database.close());

	const schemaObjectsSql = `SELECT type, name, tbl_name, sql FROM sqlite_master
		 WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
		 ORDER BY type, name`;

	assert.deepEqual(
		readRows(upgradedConnection.database, schemaObjectsSql),
		readRows(freshConnection.database, schemaObjectsSql),
	);
});

test('stores only secret metadata and keychain references in SQLite', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const connection = openEnsemblrDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());

	const rawSecretValue = 'ensemblr-raw-secret-value-not-persisted';
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
			'ENSEMBLR_TEST_SECRET',
			'macos-keychain',
			'dev.ensemblr.app.secret-store',
			'v1:app::ENSEMBLR_TEST_SECRET',
			'Ensemblr test secret',
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

	const connection = openEnsemblrDatabase({
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

	const service = createEnsemblrDatabaseService({
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

	const connection = openEnsemblrDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());

	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch, metadata_json)
VALUES
	('repo-1', 'ensemblr', 'Ensemblr', '/tmp/ensemblr/repo', 'master', '{"owner":"alice","avatarUrl":"https://example.com/avatar.png"}'),
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
	('workspace-1', 'repo-1', 'the-120', 'THE-120', '/tmp/ensemblr/workspaces/the-120', 'philipp/the-120', 'master', NULL, '{"linearIssue":"THE-120"}'),
	('workspace-archived', 'repo-1', 'archived', 'Archived', '/tmp/ensemblr/workspaces/archived', 'archived', 'master', '2026-06-01T00:00:00.000Z', '{}'),
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

test('repository workspace navigation snapshot excludes archived repositories', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const connection = openEnsemblrDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());

	// An archived repository (and its still-on-disk workspace) must never leak
	// back into the sidebar — otherwise archiving a repo "comes back" on the
	// next launch. The snapshot carries no archived flag, so the cut happens in
	// SQL; this regression-tests that filter.
	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch, metadata_json, archived_at)
VALUES
	('repo-active', 'active', 'Active', '/tmp/active/repo', 'main', '{}', NULL),
	('repo-archived', 'archived', 'Archived', '/tmp/archived/repo', 'main', '{}', '2026-06-01T00:00:00.000Z');

INSERT INTO workspaces (id, repository_id, slug, name, path, branch_name, base_branch, archived_at, metadata_json)
VALUES
	('ws-active', 'repo-active', 'live', 'Live', '/tmp/active/workspaces/live', 'feature', 'main', NULL, '{}'),
	('ws-archived', 'repo-archived', 'gone', 'Gone', '/tmp/archived/workspaces/gone', 'gone', 'main', '2026-06-01T00:00:00.000Z', '{}');
`);

	const snapshot = getRepositoryWorkspaceNavigationSnapshot(
		connection.database,
	);

	assert.deepEqual(
		snapshot.repositories.map((repository) => repository.id),
		['repo-active'],
	);
});

test('repository workspace navigation snapshot handles empty database', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const connection = openEnsemblrDatabase({
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

test('migration 015 blanks the English "New chat" placeholder but spares a chosen title', (t) => {
	const fixture = createTestDatabasePath();
	t.after(fixture.cleanup);

	const seeded = openEnsemblrDatabase({ databasePath: fixture.databasePath });
	seeded.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-untitled', 'untitled', 'Untitled', '/tmp/ensemblr/untitled', 'main');

INSERT INTO workspaces (id, repository_id, slug, name, path, branch_name, base_branch)
VALUES ('ws-untitled', 'repo-untitled', 'the-200', 'THE-200', '/tmp/ensemblr/workspaces/the-200', 'philipp/the-200', 'main');

INSERT INTO chat_tabs (id, workspace_id, kind, title, full_title, position, metadata_json)
VALUES
	('tab-placeholder', 'ws-untitled', 'chat', 'New chat', 'New chat', 0, '{}'),
	('tab-legacy-blank-full', 'ws-untitled', 'chat', 'New chat', '', 1, '{}'),
	('tab-named', 'ws-untitled', 'chat', 'New chat', 'New chat about the parser', 2, '{}'),
	('tab-user-named', 'ws-untitled', 'chat', 'Fix the parser', 'Fix the parser', 3, '{}'),
	('tab-chose-the-placeholder', 'ws-untitled', 'chat', 'New chat', 'New chat', 4, '{"titleProvenance":"user","titleAutoNamed":true}');
`);
	seeded.database
		.prepare('DELETE FROM schema_migrations WHERE id = ?')
		.run('015_untitled_chat_tab_placeholder');
	seeded.database.close();

	const connection = openEnsemblrDatabase({
		databasePath: fixture.databasePath,
	});
	t.after(() => connection.database.close());

	assert.deepEqual(
		readRows(
			connection.database,
			'SELECT id, title, full_title FROM chat_tabs ORDER BY position',
		),
		[
			{ full_title: '', id: 'tab-placeholder', title: '' },
			{ full_title: '', id: 'tab-legacy-blank-full', title: '' },
			{
				full_title: 'New chat about the parser',
				id: 'tab-named',
				title: 'New chat',
			},
			{
				full_title: 'Fix the parser',
				id: 'tab-user-named',
				title: 'Fix the parser',
			},
			{
				full_title: 'New chat',
				id: 'tab-chose-the-placeholder',
				title: 'New chat',
			},
		],
	);
});
