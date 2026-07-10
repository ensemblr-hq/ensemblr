import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { DatabaseHealthSnapshot } from '../../shared/ipc/contracts/health';

/** Options for {@link openEnsemblrDatabase} / {@link createEnsemblrDatabaseService}. */
export interface OpenDatabaseOptions {
	databasePath?: string;
}

/** A live SQLite connection plus its file path and applied schema version. */
export interface EnsemblrDatabaseConnection {
	database: DatabaseSync;
	path: string;
	schemaVersion: number;
}

/** Public surface of the database service held by the main process. */
export interface EnsemblrDatabaseService {
	close: () => void;
	getConnection: () => EnsemblrDatabaseConnection | null;
	getHealth: () => DatabaseHealthSnapshot;
	open: () => DatabaseHealthSnapshot;
}

/**
 * Asserts an open database handle, throwing the caller's domain error when
 * absent so each subsystem keeps its typed error surface.
 */
export function requireDatabase(
	database: DatabaseSync | null | undefined,
	onUnavailable: () => Error = () => new Error('Database is not open.'),
): DatabaseSync {
	if (!database) {
		throw onUnavailable();
	}
	return database;
}

/** Internal: one declarative schema migration. */
interface Migration {
	id: string;
	sql: string;
	version: number;
}

const DATABASE_FILENAME = 'ensemblr.db';
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
	source TEXT NOT NULL CHECK (source IN ('built-in-default', 'conductor-config', 'config-default', 'managed-config', 'ensemblr-config', 'sqlite')),
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
	{
		id: '004_archive_lifecycle',
		version: 4,
		sql: `
ALTER TABLE repositories ADD COLUMN archived_at TEXT;

CREATE INDEX idx_workspaces_archived_at ON workspaces(archived_at);
CREATE INDEX idx_repositories_archived_at ON repositories(archived_at);

CREATE TABLE archive_records (
	id TEXT PRIMARY KEY,
	record_type TEXT NOT NULL CHECK (record_type IN ('workspace', 'repository')),
	repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
	workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
	repository_slug TEXT NOT NULL,
	workspace_slug TEXT,
	branch_name TEXT,
	base_branch TEXT,
	source_path TEXT NOT NULL,
	archived_context_path TEXT,
	branch_cleanup INTEGER NOT NULL DEFAULT 0 CHECK (branch_cleanup IN (0, 1)),
	archive_reason TEXT,
	archived_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	metadata_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE INDEX idx_archive_records_repository_id ON archive_records(repository_id);
CREATE INDEX idx_archive_records_workspace_id ON archive_records(workspace_id);
CREATE INDEX idx_archive_records_type ON archive_records(record_type);
`,
	},
	{
		id: '005_pi_session_metadata',
		version: 5,
		sql: `
CREATE TABLE pi_sessions (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	pi_session_id TEXT,
	executable_id TEXT,
	executable_path TEXT,
	model TEXT,
	thinking_level TEXT,
	status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'starting', 'streaming', 'closed', 'errored')),
	last_error TEXT,
	cwd TEXT NOT NULL,
	label TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	closed_at TEXT,
	metadata_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE INDEX idx_pi_sessions_workspace_id ON pi_sessions(workspace_id);
CREATE INDEX idx_pi_sessions_status ON pi_sessions(status);
CREATE INDEX idx_pi_sessions_pi_session_id ON pi_sessions(pi_session_id);

CREATE TABLE pi_session_branches (
	id TEXT PRIMARY KEY,
	pi_session_id TEXT NOT NULL REFERENCES pi_sessions(id) ON DELETE CASCADE,
	parent_branch_id TEXT REFERENCES pi_session_branches(id) ON DELETE SET NULL,
	forked_from_turn_id TEXT,
	kind TEXT NOT NULL CHECK (kind IN ('main', 'retry', 'fork')),
	label TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	metadata_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE INDEX idx_pi_session_branches_session_id ON pi_session_branches(pi_session_id);
CREATE INDEX idx_pi_session_branches_parent ON pi_session_branches(parent_branch_id);

CREATE TABLE pi_turns (
	id TEXT PRIMARY KEY,
	branch_id TEXT NOT NULL REFERENCES pi_session_branches(id) ON DELETE CASCADE,
	ordinal INTEGER NOT NULL,
	status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'streaming', 'completed', 'aborted', 'errored')),
	prompt_text TEXT NOT NULL DEFAULT '',
	model TEXT,
	thinking_level TEXT,
	submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	completed_at TEXT,
	turn_metadata_json TEXT NOT NULL DEFAULT '{}',
	UNIQUE(branch_id, ordinal)
) STRICT;

CREATE INDEX idx_pi_turns_branch_ordinal ON pi_turns(branch_id, ordinal);
CREATE INDEX idx_pi_turns_status ON pi_turns(status);

CREATE TABLE pi_session_events (
	id TEXT PRIMARY KEY,
	branch_id TEXT NOT NULL REFERENCES pi_session_branches(id) ON DELETE CASCADE,
	turn_id TEXT REFERENCES pi_turns(id) ON DELETE SET NULL,
	ordinal INTEGER NOT NULL,
	event_type TEXT NOT NULL,
	stream TEXT NOT NULL DEFAULT 'protocol' CHECK (stream IN ('protocol', 'stderr')),
	payload_json TEXT NOT NULL DEFAULT '{}',
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	UNIQUE(branch_id, ordinal)
) STRICT;

CREATE INDEX idx_pi_session_events_branch_ordinal ON pi_session_events(branch_id, ordinal);
CREATE INDEX idx_pi_session_events_turn_id ON pi_session_events(turn_id);
CREATE INDEX idx_pi_session_events_type ON pi_session_events(event_type);

CREATE TABLE chat_tabs (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	pi_session_id TEXT REFERENCES pi_sessions(id) ON DELETE SET NULL,
	kind TEXT NOT NULL CHECK (kind IN ('chat', 'preview')),
	title TEXT NOT NULL,
	position INTEGER NOT NULL DEFAULT 0,
	opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	closed_at TEXT,
	metadata_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE INDEX idx_chat_tabs_workspace_id ON chat_tabs(workspace_id);
CREATE INDEX idx_chat_tabs_session_id ON chat_tabs(pi_session_id);
CREATE INDEX idx_chat_tabs_open ON chat_tabs(workspace_id, closed_at);

CREATE TABLE pi_runtime_state (
	workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
	active_tab_id TEXT REFERENCES chat_tabs(id) ON DELETE SET NULL,
	last_active_session_id TEXT REFERENCES pi_sessions(id) ON DELETE SET NULL,
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
`,
	},
	{
		id: '006_repository_remote_url_index',
		version: 6,
		sql: `
ALTER TABLE repositories ADD COLUMN remote_url TEXT NOT NULL DEFAULT '';

UPDATE repositories
SET remote_url = COALESCE(lower(trim(json_extract(metadata_json, '$.remoteUrl'))), '');

UPDATE repositories SET remote_url = substr(remote_url, 9) WHERE remote_url LIKE 'https://%';
UPDATE repositories SET remote_url = substr(remote_url, 8) WHERE remote_url LIKE 'http://%';
UPDATE repositories SET remote_url = substr(remote_url, 7) WHERE remote_url LIKE 'ssh://%';
UPDATE repositories SET remote_url = substr(remote_url, 7) WHERE remote_url LIKE 'git://%';
UPDATE repositories SET remote_url = substr(remote_url, 5) WHERE remote_url LIKE 'git@%';
UPDATE repositories SET remote_url = replace(remote_url, ':', '/') WHERE remote_url LIKE '%:%';
UPDATE repositories SET remote_url = substr(remote_url, 1, length(remote_url) - 4) WHERE remote_url LIKE '%.git';
UPDATE repositories SET remote_url = rtrim(remote_url, '/') WHERE remote_url LIKE '%/';

CREATE INDEX idx_repositories_remote_url ON repositories(remote_url) WHERE remote_url <> '';
`,
	},
	{
		id: '007_chat_tab_kinds',
		version: 7,
		// Widens the chat_tabs.kind CHECK to the full tab-kind set. SQLite cannot
		// alter a CHECK in place, so both chat_tabs and its dependent
		// pi_runtime_state are rebuilt. pi_runtime_state_new temporarily
		// references chat_tabs_new so the later DROP TABLE chat_tabs cannot fire
		// ON DELETE SET NULL against the copied rows; the RENAME afterwards
		// rewrites that reference back to chat_tabs.
		sql: `
CREATE TABLE chat_tabs_new (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	pi_session_id TEXT REFERENCES pi_sessions(id) ON DELETE SET NULL,
	kind TEXT NOT NULL CHECK (kind IN ('chat', 'file', 'diff', 'document', 'preview')),
	title TEXT NOT NULL,
	position INTEGER NOT NULL DEFAULT 0,
	opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	closed_at TEXT,
	metadata_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

INSERT INTO chat_tabs_new (id, workspace_id, pi_session_id, kind, title, position, opened_at, closed_at, metadata_json)
SELECT id, workspace_id, pi_session_id, kind, title, position, opened_at, closed_at, metadata_json FROM chat_tabs;

CREATE TABLE pi_runtime_state_new (
	workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
	active_tab_id TEXT REFERENCES chat_tabs_new(id) ON DELETE SET NULL,
	last_active_session_id TEXT REFERENCES pi_sessions(id) ON DELETE SET NULL,
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

INSERT INTO pi_runtime_state_new (workspace_id, active_tab_id, last_active_session_id, updated_at)
SELECT workspace_id, active_tab_id, last_active_session_id, updated_at FROM pi_runtime_state;

DROP TABLE pi_runtime_state;
DROP TABLE chat_tabs;

ALTER TABLE chat_tabs_new RENAME TO chat_tabs;
ALTER TABLE pi_runtime_state_new RENAME TO pi_runtime_state;

CREATE INDEX idx_chat_tabs_workspace_id ON chat_tabs(workspace_id);
CREATE INDEX idx_chat_tabs_session_id ON chat_tabs(pi_session_id);
CREATE INDEX idx_chat_tabs_open ON chat_tabs(workspace_id, closed_at);
`,
	},
	{
		id: '008_checkpoint_pi_linkage',
		version: 8,
		// Links checkpoints to Pi sessions/turns (ADR 0012). The legacy
		// `session_id` column referencing `sessions` is kept untouched.
		sql: `
ALTER TABLE checkpoints ADD COLUMN pi_session_id TEXT REFERENCES pi_sessions(id) ON DELETE SET NULL;
ALTER TABLE checkpoints ADD COLUMN turn_id TEXT REFERENCES pi_turns(id) ON DELETE SET NULL;
ALTER TABLE checkpoints ADD COLUMN git_hash TEXT;

CREATE INDEX idx_checkpoints_pi_session_id ON checkpoints(pi_session_id);
-- One checkpoint per turn: the capture path and getCheckpointByTurnId assume it.
CREATE UNIQUE INDEX idx_checkpoints_turn_id ON checkpoints(turn_id) WHERE turn_id IS NOT NULL;
`,
	},
	{
		id: '009_linear_cache',
		version: 9,
		// Refreshable cache of Linear issues and metadata (ADR 0024). Linear stays
		// the source of truth; rows carry synced_at for staleness display. Tokens
		// never land here — they live in the Keychain (ADR 0018).
		sql: `
CREATE TABLE linear_issues (
	id TEXT PRIMARY KEY,
	identifier TEXT NOT NULL,
	title TEXT NOT NULL,
	description TEXT,
	team_id TEXT,
	project_id TEXT,
	state_id TEXT,
	assignee_id TEXT,
	priority INTEGER,
	due_date TEXT,
	url TEXT NOT NULL DEFAULT '',
	archived_at TEXT,
	remote_updated_at TEXT,
	data_json TEXT NOT NULL DEFAULT '{}',
	synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX idx_linear_issues_identifier ON linear_issues(identifier);
CREATE INDEX idx_linear_issues_team_id ON linear_issues(team_id);
CREATE INDEX idx_linear_issues_remote_updated_at ON linear_issues(remote_updated_at);

CREATE TABLE linear_resources (
	id TEXT PRIMARY KEY,
	kind TEXT NOT NULL CHECK (kind IN ('team', 'project', 'state', 'label', 'cycle', 'user')),
	team_id TEXT,
	name TEXT NOT NULL,
	data_json TEXT NOT NULL DEFAULT '{}',
	synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX idx_linear_resources_kind ON linear_resources(kind, team_id);

CREATE TABLE linear_comments (
	id TEXT PRIMARY KEY,
	issue_id TEXT NOT NULL,
	author_name TEXT,
	body TEXT NOT NULL DEFAULT '',
	remote_created_at TEXT,
	data_json TEXT NOT NULL DEFAULT '{}',
	synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX idx_linear_comments_issue_id ON linear_comments(issue_id);

CREATE TABLE linear_sync_state (
	scope TEXT PRIMARY KEY,
	cursor TEXT,
	status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'syncing', 'error')),
	error_code TEXT,
	synced_at TEXT
) STRICT;
`,
	},
];

/** Highest declared migration version embedded in this build. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

/**
 * Computes the default SQLite database path inside a home directory, branching
 * by platform (macOS Application Support vs. XDG-style `.config`).
 * @param homeDirectory - Home directory; defaults to `os.homedir()`.
 * @returns Absolute database path.
 */
export function resolveDefaultDatabasePath(homeDirectory = homedir()): string {
	if (process.platform === 'darwin') {
		return path.join(
			homeDirectory,
			'Library',
			'Application Support',
			'dev.ensemblr.app',
			DATABASE_FILENAME,
		);
	}

	return path.join(homeDirectory, '.config', 'ensemblr', DATABASE_FILENAME);
}

/**
 * Opens the SQLite database, ensures its parent directory exists, configures
 * pragmas, and applies any pending migrations.
 * @param options - Optional path override; `:memory:` is honored for tests.
 * @returns An open {@link EnsemblrDatabaseConnection}.
 */
export function openEnsemblrDatabase(
	options: OpenDatabaseOptions = {},
): EnsemblrDatabaseConnection {
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

/**
 * Builds a lazily-opening database service whose lifecycle is owned by the
 * Electron main process.
 * @param options - Forwarded to {@link openEnsemblrDatabase} on first open.
 * @returns A {@link EnsemblrDatabaseService}.
 */
export function createEnsemblrDatabaseService(
	options: OpenDatabaseOptions = {},
): EnsemblrDatabaseService {
	let connection: EnsemblrDatabaseConnection | null = null;
	let health: DatabaseHealthSnapshot = {
		path: options.databasePath ?? resolveDefaultDatabasePath(),
		schemaVersion: 0,
		status: 'error',
	};

	/** Opens the database if not already open; returns the current health snapshot. */
	function open(): DatabaseHealthSnapshot {
		if (connection) {
			return health;
		}

		try {
			connection = openEnsemblrDatabase(options);
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

	/** Closes the database, if open. Safe to call when no connection exists. */
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

/**
 * Reads `PRAGMA user_version` to determine the active schema version.
 * @param database - Open SQLite connection.
 * @returns The version, or `0` when the pragma row is unexpected.
 */
export function getCurrentSchemaVersion(database: DatabaseSync): number {
	const row = database.prepare('PRAGMA user_version').get();

	if (!isUserVersionRow(row)) {
		return 0;
	}

	return row.user_version;
}

/**
 * Lists migration identifiers already applied to the database.
 * @param database - Open SQLite connection.
 * @returns Ordered list of applied migration ids.
 */
export function listAppliedMigrationIds(database: DatabaseSync): string[] {
	ensureMigrationTable(database);

	const rows = database
		.prepare('SELECT id FROM schema_migrations ORDER BY version')
		.all();

	return rows.flatMap((row) => (isMigrationIdRow(row) ? [row.id] : []));
}

/**
 * Applies connection-wide pragmas (foreign keys, busy timeout, WAL journal).
 * @param database - Open SQLite connection.
 */
function configureDatabase(database: DatabaseSync): void {
	database.exec(`
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA journal_mode = WAL;
`);
}

/**
 * Runs every unapplied migration in declared order, returning the final version.
 * @param database - Open SQLite connection.
 * @returns The active schema version after migration.
 */
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

/**
 * Creates `schema_migrations` if it does not already exist.
 * @param database - Open SQLite connection.
 */
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

/**
 * Applies a single migration inside a transaction, recording the row in
 * `schema_migrations` and updating `PRAGMA user_version`.
 * @param database - Open SQLite connection.
 * @param migration - Migration to apply.
 */
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

/**
 * Coerces a thrown value into a user-facing message.
 * @param error - Thrown value.
 * @returns Human-readable message.
 */
function formatDatabaseError(error: unknown): string {
	return error instanceof Error ? error.message : 'Unknown database error';
}

/**
 * Type guard for the row shape of `SELECT id FROM schema_migrations`.
 * @param row - Candidate row.
 * @returns True when the row has a string `id` column.
 */
function isMigrationIdRow(row: unknown): row is { id: string } {
	return (
		typeof row === 'object' &&
		row !== null &&
		'id' in row &&
		typeof row.id === 'string'
	);
}

/**
 * Type guard for the row shape of `PRAGMA user_version`.
 * @param row - Candidate row.
 * @returns True when the row has a numeric `user_version` column.
 */
function isUserVersionRow(row: unknown): row is { user_version: number } {
	return (
		typeof row === 'object' &&
		row !== null &&
		'user_version' in row &&
		typeof row.user_version === 'number'
	);
}
