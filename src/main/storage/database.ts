import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type DatabaseStatus = 'ok' | 'error';

export interface DatabaseHealthSnapshot {
	error?: string;
	path: string;
	schemaVersion: number;
	status: DatabaseStatus;
}

export interface OpenDatabaseOptions {
	databasePath?: string;
}

export interface PiductorDatabaseConnection {
	database: DatabaseSync;
	path: string;
	schemaVersion: number;
}

export interface PiductorDatabaseService {
	close: () => void;
	getConnection: () => PiductorDatabaseConnection | null;
	getHealth: () => DatabaseHealthSnapshot;
	open: () => DatabaseHealthSnapshot;
}

interface Migration {
	id: string;
	sql: string;
	version: number;
}

const DATABASE_FILENAME = 'piductor.db';
const SQLITE_MEMORY_PATH = ':memory:';
const MIGRATIONS: readonly Migration[] = [
	{
		id: '001_foundation_metadata',
		version: 1,
		sql: `
CREATE TABLE repositories (
	id TEXT PRIMARY KEY,
	slug TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	path TEXT NOT NULL UNIQUE,
	default_branch TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	metadata_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE TABLE workspaces (
	id TEXT PRIMARY KEY,
	repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
	slug TEXT NOT NULL,
	name TEXT NOT NULL,
	path TEXT NOT NULL UNIQUE,
	branch_name TEXT,
	base_branch TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	archived_at TEXT,
	metadata_json TEXT NOT NULL DEFAULT '{}',
	UNIQUE(repository_id, slug)
) STRICT;

CREATE INDEX idx_workspaces_repository_id ON workspaces(repository_id);

CREATE TABLE settings (
	id TEXT PRIMARY KEY,
	scope TEXT NOT NULL CHECK (scope IN ('app', 'repository', 'workspace')),
	scope_id TEXT NOT NULL DEFAULT '',
	key TEXT NOT NULL,
	value_json TEXT NOT NULL,
	source TEXT NOT NULL DEFAULT 'sqlite' CHECK (source IN ('sqlite', 'managed-config', 'repo-config', 'default')),
	locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	UNIQUE(scope, scope_id, key)
) STRICT;

CREATE INDEX idx_settings_scope ON settings(scope, scope_id);

CREATE TABLE sessions (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	title TEXT NOT NULL,
	runtime TEXT NOT NULL DEFAULT 'pi',
	status TEXT NOT NULL CHECK (status IN ('created', 'running', 'paused', 'completed', 'failed', 'canceled')),
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	last_event_at TEXT,
	metadata_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE INDEX idx_sessions_workspace_id ON sessions(workspace_id);
CREATE INDEX idx_sessions_status ON sessions(status);

CREATE TABLE terminal_sessions (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
	title TEXT NOT NULL,
	shell TEXT,
	cwd TEXT,
	status TEXT NOT NULL CHECK (status IN ('created', 'running', 'exited', 'failed')),
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	ended_at TEXT,
	metadata_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE INDEX idx_terminal_sessions_workspace_id ON terminal_sessions(workspace_id);
CREATE INDEX idx_terminal_sessions_session_id ON terminal_sessions(session_id);

CREATE TABLE checkpoints (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
	git_ref TEXT NOT NULL,
	label TEXT NOT NULL,
	reason TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	metadata_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE INDEX idx_checkpoints_workspace_id ON checkpoints(workspace_id);
CREATE INDEX idx_checkpoints_session_id ON checkpoints(session_id);

CREATE TABLE comments (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
	checkpoint_id TEXT REFERENCES checkpoints(id) ON DELETE SET NULL,
	file_path TEXT NOT NULL,
	line_number INTEGER,
	body TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'archived')),
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	metadata_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE INDEX idx_comments_workspace_id ON comments(workspace_id);
CREATE INDEX idx_comments_session_id ON comments(session_id);
CREATE INDEX idx_comments_checkpoint_id ON comments(checkpoint_id);

CREATE TABLE todos (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
	title TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'canceled')),
	position INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	metadata_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE INDEX idx_todos_workspace_id ON todos(workspace_id);
CREATE INDEX idx_todos_session_id ON todos(session_id);
CREATE INDEX idx_todos_status ON todos(status);

CREATE TABLE integration_metadata (
	id TEXT PRIMARY KEY,
	provider TEXT NOT NULL CHECK (provider IN ('github', 'linear', 'pi', 'git', 'system')),
	resource_type TEXT NOT NULL,
	resource_id TEXT NOT NULL,
	external_id TEXT NOT NULL DEFAULT '',
	synced_at TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	metadata_json TEXT NOT NULL DEFAULT '{}',
	UNIQUE(provider, resource_type, resource_id, external_id)
) STRICT;

CREATE INDEX idx_integration_metadata_provider ON integration_metadata(provider, resource_type);

CREATE TABLE process_records (
	id TEXT PRIMARY KEY,
	workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
	session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
	kind TEXT NOT NULL CHECK (kind IN ('setup', 'run-script', 'terminal', 'pi-rpc', 'git', 'github', 'linear', 'system')),
	status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'exited', 'failed', 'canceled')),
	pid INTEGER,
	command_label TEXT NOT NULL,
	exit_code INTEGER,
	started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	ended_at TEXT,
	metadata_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE INDEX idx_process_records_workspace_id ON process_records(workspace_id);
CREATE INDEX idx_process_records_session_id ON process_records(session_id);
CREATE INDEX idx_process_records_status ON process_records(status);
`,
	},
	{
		id: '002_secret_metadata',
		version: 2,
		sql: `
CREATE TABLE secret_metadata (
	id TEXT PRIMARY KEY,
	scope TEXT NOT NULL CHECK (scope IN ('app', 'repository', 'workspace')),
	scope_id TEXT NOT NULL DEFAULT '',
	name TEXT NOT NULL,
	backend TEXT NOT NULL DEFAULT 'macos-keychain' CHECK (backend IN ('macos-keychain')),
	service TEXT NOT NULL,
	account TEXT NOT NULL,
	display_name TEXT NOT NULL,
	masked_display TEXT NOT NULL,
	character_count INTEGER NOT NULL DEFAULT 0 CHECK (character_count >= 0),
	metadata_json TEXT NOT NULL DEFAULT '{}',
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	UNIQUE(scope, scope_id, name),
	UNIQUE(service, account)
) STRICT;

CREATE INDEX idx_secret_metadata_scope ON secret_metadata(scope, scope_id);
`,
	},
	{
		id: '003_root_directory_metadata',
		version: 3,
		sql: `
CREATE TABLE root_directories (
	id TEXT PRIMARY KEY,
	path TEXT NOT NULL UNIQUE,
	source TEXT NOT NULL CHECK (source IN ('built-in-default', 'conductor-config', 'config-default', 'managed-config', 'piductor-config', 'sqlite')),
	status TEXT NOT NULL CHECK (status IN ('ok', 'warning', 'error')),
	repositories_path TEXT NOT NULL,
	workspaces_path TEXT NOT NULL,
	archived_contexts_path TEXT NOT NULL,
	first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	metadata_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE INDEX idx_root_directories_status ON root_directories(status);
`,
	},
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

export function resolveDefaultDatabasePath(homeDirectory = homedir()): string {
	if (process.platform === 'darwin') {
		return path.join(
			homeDirectory,
			'Library',
			'Application Support',
			'com.piductor.app',
			DATABASE_FILENAME,
		);
	}

	return path.join(homeDirectory, '.config', 'piductor', DATABASE_FILENAME);
}

export function openPiductorDatabase(
	options: OpenDatabaseOptions = {},
): PiductorDatabaseConnection {
	const databasePath = options.databasePath ?? resolveDefaultDatabasePath();

	if (databasePath !== SQLITE_MEMORY_PATH) {
		mkdirSync(path.dirname(databasePath), { recursive: true });
	}

	const database = new DatabaseSync(databasePath, {
		allowExtension: false,
		defensive: true,
		enableForeignKeyConstraints: true,
		timeout: 5000,
	});

	try {
		configureDatabase(database);
		const schemaVersion = runMigrations(database);

		return {
			database,
			path: databasePath,
			schemaVersion,
		};
	} catch (error) {
		database.close();
		throw error;
	}
}

export function createPiductorDatabaseService(
	options: OpenDatabaseOptions = {},
): PiductorDatabaseService {
	let connection: PiductorDatabaseConnection | null = null;
	let health: DatabaseHealthSnapshot = {
		path: options.databasePath ?? resolveDefaultDatabasePath(),
		schemaVersion: 0,
		status: 'error',
	};

	function open(): DatabaseHealthSnapshot {
		if (connection) {
			return health;
		}

		try {
			connection = openPiductorDatabase(options);
			health = {
				path: connection.path,
				schemaVersion: connection.schemaVersion,
				status: 'ok',
			};
		} catch (error) {
			health = {
				error: formatDatabaseError(error),
				path: options.databasePath ?? resolveDefaultDatabasePath(),
				schemaVersion: 0,
				status: 'error',
			};
		}

		return health;
	}

	function close(): void {
		if (!connection) {
			return;
		}

		connection.database.close();
		connection = null;
	}

	return {
		close,
		getConnection: () => connection,
		getHealth: () => health,
		open,
	};
}

export function getCurrentSchemaVersion(database: DatabaseSync): number {
	const row = database.prepare('PRAGMA user_version').get();

	if (!isUserVersionRow(row)) {
		return 0;
	}

	return row.user_version;
}

export function listAppliedMigrationIds(database: DatabaseSync): string[] {
	ensureMigrationTable(database);

	const rows = database
		.prepare('SELECT id FROM schema_migrations ORDER BY version')
		.all();

	return rows.flatMap((row) => (isMigrationIdRow(row) ? [row.id] : []));
}

function configureDatabase(database: DatabaseSync): void {
	database.exec(`
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA journal_mode = WAL;
`);
}

function runMigrations(database: DatabaseSync): number {
	ensureMigrationTable(database);

	const appliedMigrationIds = new Set(listAppliedMigrationIds(database));

	for (const migration of MIGRATIONS) {
		if (appliedMigrationIds.has(migration.id)) {
			continue;
		}

		runMigration(database, migration);
	}

	return getCurrentSchemaVersion(database);
}

function ensureMigrationTable(database: DatabaseSync): void {
	database.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
	id TEXT PRIMARY KEY,
	version INTEGER NOT NULL UNIQUE,
	name TEXT NOT NULL,
	applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
`);
}

function runMigration(database: DatabaseSync, migration: Migration): void {
	database.exec('BEGIN IMMEDIATE;');

	try {
		database.exec(migration.sql);
		database
			.prepare(
				'INSERT INTO schema_migrations (id, version, name) VALUES (?, ?, ?)',
			)
			.run(migration.id, migration.version, migration.id);
		database.exec(`PRAGMA user_version = ${migration.version};`);
		database.exec('COMMIT;');
	} catch (error) {
		database.exec('ROLLBACK;');
		throw error;
	}
}

function formatDatabaseError(error: unknown): string {
	return error instanceof Error ? error.message : 'Unknown database error';
}

function isMigrationIdRow(row: unknown): row is { id: string } {
	return (
		typeof row === 'object' &&
		row !== null &&
		'id' in row &&
		typeof row.id === 'string'
	);
}

function isUserVersionRow(row: unknown): row is { user_version: number } {
	return (
		typeof row === 'object' &&
		row !== null &&
		'user_version' in row &&
		typeof row.user_version === 'number'
	);
}
