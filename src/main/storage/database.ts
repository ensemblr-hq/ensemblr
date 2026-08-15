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
	{
		id: '010_chat_tab_terminal_kind',
		version: 10,
		// Adds the 'terminal' tab kind (agent-harness terminals). SQLite cannot
		// alter a CHECK in place, so chat_tabs and its dependent pi_runtime_state
		// are rebuilt exactly as migration 007 did: pi_runtime_state_new
		// temporarily references chat_tabs_new so the DROP TABLE chat_tabs cannot
		// fire ON DELETE SET NULL against the copied rows; the RENAME rewrites the
		// reference back to chat_tabs.
		sql: `
CREATE TABLE chat_tabs_new (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	pi_session_id TEXT REFERENCES pi_sessions(id) ON DELETE SET NULL,
	kind TEXT NOT NULL CHECK (kind IN ('chat', 'file', 'diff', 'document', 'preview', 'terminal')),
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
		id: '011_chat_tab_full_title',
		version: 11,
		// `title` is capped for tab display, so the untruncated name was previously
		// lost before it reached the renderer. `full_title` keeps it for tooltips.
		// Existing rows backfill from `title`: their untruncated text is already
		// gone, so the capped string is the best available value.
		sql: `
ALTER TABLE chat_tabs ADD COLUMN full_title TEXT NOT NULL DEFAULT '';

UPDATE chat_tabs SET full_title = title;
`,
	},
	{
		id: '012_comment_origin',
		version: 12,
		// Agents can now file review comments, so a comment has to say who wrote
		// it. Existing rows are the user's by definition, which is also the
		// default a renderer that predates this column would have implied. No
		// inline CHECK: SQLite's ADD COLUMN restrictions make one fragile, and the
		// value set is enforced by the TS union and the Zod schema at the boundary.
		sql: `
ALTER TABLE comments ADD COLUMN origin TEXT NOT NULL DEFAULT 'user';
`,
	},
	{
		id: '013_pi_session_provider',
		version: 13,
		// A chat is pinned to one agent runtime, and the pin is derivable through
		// the bound session — so it lives here rather than on `chat_tabs`. Every
		// existing row predates a second runtime and is therefore Pi's, which is
		// also what a renderer that predates this column would assume. No inline
		// CHECK: SQLite's ADD COLUMN restrictions make one fragile, and the value
		// set is enforced by `shared/agent-provider.ts` at the boundary.
		sql: `
ALTER TABLE pi_sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'pi';

CREATE INDEX idx_pi_sessions_provider ON pi_sessions(provider);
`,
	},
	{
		id: '014_agent_session_vocabulary',
		version: 14,
		// Sessions, turns, events and branches are provider-neutral now that Claude
		// is a sibling runtime to Pi, so the `pi_*` spelling moves to `agent_*`.
		// `agent_sessions.pi_session_id` becomes `runtime_session_id` rather than
		// `agent_session_id`: it holds the id the CLI runtime knows the session by,
		// while `chat_tabs`/`checkpoints`/`agent_session_branches.agent_session_id`
		// all foreign-key `agent_sessions.id`. One name for both would be silent.
		// `ALTER TABLE ... RENAME TO` carries indexes across but keeps their old
		// names, so every `pi`-spelled index is dropped and recreated: a database
		// migrated from 013 and one created from scratch must agree byte for byte
		// in `sqlite_master`. `idx_chat_tabs_session_id` keeps its name and is
		// recreated only to drop the quoting SQLite adds when it rewrites an index
		// over a renamed column.
		sql: `
DROP INDEX idx_pi_sessions_workspace_id;
DROP INDEX idx_pi_sessions_status;
DROP INDEX idx_pi_sessions_pi_session_id;
DROP INDEX idx_pi_sessions_provider;
DROP INDEX idx_pi_session_branches_session_id;
DROP INDEX idx_pi_session_branches_parent;
DROP INDEX idx_pi_turns_branch_ordinal;
DROP INDEX idx_pi_turns_status;
DROP INDEX idx_pi_session_events_branch_ordinal;
DROP INDEX idx_pi_session_events_turn_id;
DROP INDEX idx_pi_session_events_type;
DROP INDEX idx_checkpoints_pi_session_id;
DROP INDEX idx_chat_tabs_session_id;

ALTER TABLE pi_sessions RENAME TO agent_sessions;
ALTER TABLE pi_session_branches RENAME TO agent_session_branches;
ALTER TABLE pi_turns RENAME TO agent_turns;
ALTER TABLE pi_session_events RENAME TO agent_session_events;
ALTER TABLE pi_runtime_state RENAME TO agent_runtime_state;

ALTER TABLE agent_sessions RENAME COLUMN pi_session_id TO runtime_session_id;
ALTER TABLE agent_session_branches RENAME COLUMN pi_session_id TO agent_session_id;
ALTER TABLE chat_tabs RENAME COLUMN pi_session_id TO agent_session_id;
ALTER TABLE checkpoints RENAME COLUMN pi_session_id TO agent_session_id;

CREATE INDEX idx_agent_sessions_workspace_id ON agent_sessions(workspace_id);
CREATE INDEX idx_agent_sessions_status ON agent_sessions(status);
CREATE INDEX idx_agent_sessions_runtime_session_id ON agent_sessions(runtime_session_id);
CREATE INDEX idx_agent_sessions_provider ON agent_sessions(provider);
CREATE INDEX idx_agent_session_branches_session_id ON agent_session_branches(agent_session_id);
CREATE INDEX idx_agent_session_branches_parent ON agent_session_branches(parent_branch_id);
CREATE INDEX idx_agent_turns_branch_ordinal ON agent_turns(branch_id, ordinal);
CREATE INDEX idx_agent_turns_status ON agent_turns(status);
CREATE INDEX idx_agent_session_events_branch_ordinal ON agent_session_events(branch_id, ordinal);
CREATE INDEX idx_agent_session_events_turn_id ON agent_session_events(turn_id);
CREATE INDEX idx_agent_session_events_type ON agent_session_events(event_type);
CREATE INDEX idx_checkpoints_agent_session_id ON checkpoints(agent_session_id);
CREATE INDEX idx_chat_tabs_session_id ON chat_tabs(agent_session_id);
`,
	},
	{
		id: '015_untitled_chat_tab_placeholder',
		version: 15,
		// Tabs nobody named carried the literal English `New chat`, written by the
		// main process where no i18n instance exists — so they stayed English under
		// Russian and Greek. The untitled state is now the empty string and the
		// renderer paints the localized placeholder over it. `titleProvenance` is
		// stamped by every deliberate naming and is absent on a tab nobody touched,
		// so a title someone really did choose — `New chat` included — is spared.
		sql: `
UPDATE chat_tabs
SET title = '', full_title = ''
WHERE title = 'New chat'
	AND full_title IN ('', 'New chat')
	AND json_extract(metadata_json, '$.titleProvenance') IS NULL;
`,
	},
	{
		id: '016_root_directory_source_union',
		version: 16,
		// 003 admitted a provenance value for the multi-file repository config
		// format dropped in ADR 0030. It was never a member of
		// `SettingsResolutionSource` and nothing ever wrote it, so no row can carry
		// it and the copy below does not remap: a row that somehow held it should
		// fail the new CHECK loudly rather than be silently rewritten. A CHECK is
		// schema and 003 is append-only, so the value is retired by rebuilding the
		// table rather than by editing 003. SQLite cannot alter a CHECK in place;
		// the copy-drop-rename below is the standard rebuild, and it leaves a
		// database migrated from 015 and one created from scratch agreeing byte for
		// byte in `sqlite_master`.
		sql: `
CREATE TABLE root_directories_new (
	id TEXT PRIMARY KEY,
	path TEXT NOT NULL UNIQUE,
	source TEXT NOT NULL CHECK (source IN ('built-in-default', 'config-default', 'managed-config', 'ensemblr-config', 'sqlite')),
	status TEXT NOT NULL CHECK (status IN ('ok', 'warning', 'error')),
	repositories_path TEXT NOT NULL,
	workspaces_path TEXT NOT NULL,
	archived_contexts_path TEXT NOT NULL,
	first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	metadata_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

INSERT INTO root_directories_new
SELECT
	id,
	path,
	source,
	status,
	repositories_path,
	workspaces_path,
	archived_contexts_path,
	first_seen_at,
	last_seen_at,
	metadata_json
FROM root_directories;

DROP INDEX idx_root_directories_status;
DROP TABLE root_directories;
ALTER TABLE root_directories_new RENAME TO root_directories;

CREATE INDEX idx_root_directories_status ON root_directories(status);
`,
	},
	{
		id: '017_infisical_accounts_and_links',
		version: 17,
		// `infisical_accounts` deliberately has no column for the client secret:
		// it lives in the Keychain keyed by the account id, so a database copied
		// off the machine carries no credential. `infisical_links` holds only the
		// per-machine half of a link — which account resolves it, and when it last
		// synced — because the project half is committed to the repository's
		// `.ensemblr/settings.toml` instead.
		sql: `
CREATE TABLE infisical_accounts (
	id TEXT PRIMARY KEY,
	label TEXT NOT NULL,
	site_url TEXT NOT NULL,
	client_id TEXT NOT NULL,
	last_verified_at TEXT,
	last_error_code TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	UNIQUE(site_url, client_id)
) STRICT;

CREATE TABLE infisical_links (
	scope TEXT NOT NULL CHECK (scope IN ('repository', 'workspace')),
	scope_id TEXT NOT NULL,
	account_id TEXT REFERENCES infisical_accounts(id) ON DELETE SET NULL,
	site_url TEXT,
	project_id TEXT NOT NULL,
	project_name TEXT,
	environment_slug TEXT NOT NULL,
	-- Named folder_path rather than secret_path: it holds the Infisical folder
	-- to read, never a secret value, and database.test.ts asserts that no column
	-- name looks like it stores one.
	folder_path TEXT NOT NULL DEFAULT '/',
	recursive INTEGER NOT NULL DEFAULT 0 CHECK (recursive IN (0, 1)),
	enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
	last_synced_at TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	PRIMARY KEY(scope, scope_id)
) STRICT;

CREATE INDEX idx_infisical_links_account_id ON infisical_links(account_id);
`,
	},
	{
		id: '018_infisical_link_folder_path',
		version: 18,
		// 017 first shipped its path column as `secret_path`, which trips the
		// "no column name looks like it stores a secret" assertion in
		// `database.test.ts`. Migrations are keyed by id and never re-run, so
		// editing 017 in place fixed a fresh install while leaving any database
		// that already applied it on the old column — and every write then failed
		// on the missing `folder_path`. The table holds only local link state and
		// nothing has been released, so recreating it unconditionally is both
		// cheaper and safer than a conditional rename: the result is identical
		// whichever variant 017 left behind.
		sql: `
DROP TABLE IF EXISTS infisical_links;

CREATE TABLE infisical_links (
	scope TEXT NOT NULL CHECK (scope IN ('repository', 'workspace')),
	scope_id TEXT NOT NULL,
	account_id TEXT REFERENCES infisical_accounts(id) ON DELETE SET NULL,
	site_url TEXT,
	project_id TEXT NOT NULL,
	project_name TEXT,
	environment_slug TEXT NOT NULL,
	folder_path TEXT NOT NULL DEFAULT '/',
	recursive INTEGER NOT NULL DEFAULT 0 CHECK (recursive IN (0, 1)),
	enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
	last_synced_at TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	PRIMARY KEY(scope, scope_id)
) STRICT;

CREATE INDEX idx_infisical_links_account_id ON infisical_links(account_id);
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
