import type { DatabaseSync } from 'node:sqlite';

/**
 * Data-access functions for the `terminal_sessions` table. The table's status
 * CHECK is ('created','running','exited','failed'); the renderer-facing
 * 'stopped' state is derived from `metadata_json.stopped` on an 'exited' row.
 */

/** Inputs for {@link insertTerminalSessionRow}. */
export interface InsertTerminalSessionRowOptions {
	cwd: string | null;
	database: DatabaseSync;
	id: string;
	metadataJson: string;
	shell: string | null;
	status: 'created' | 'running';
	timestamp: string;
	title: string;
	workspaceId: string;
}

/** Inserts one `terminal_sessions` row. */
export function insertTerminalSessionRow({
	cwd,
	database,
	id,
	metadataJson,
	shell,
	status,
	timestamp,
	title,
	workspaceId,
}: InsertTerminalSessionRowOptions): void {
	database
		.prepare(
			`INSERT INTO terminal_sessions (
				id,
				workspace_id,
				title,
				shell,
				cwd,
				status,
				created_at,
				updated_at,
				metadata_json
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			id,
			workspaceId,
			title,
			shell,
			cwd,
			status,
			timestamp,
			timestamp,
			metadataJson,
		);
}

/** Inputs for {@link finalizeTerminalSessionRow}. */
export interface FinalizeTerminalSessionRowOptions {
	database: DatabaseSync;
	endedAt: string;
	id: string;
	metadataJson: string;
	status: 'exited' | 'failed';
}

/** Stamps a terminal session row as ended with its final status. */
export function finalizeTerminalSessionRow({
	database,
	endedAt,
	id,
	metadataJson,
	status,
}: FinalizeTerminalSessionRowOptions): void {
	database
		.prepare(
			`UPDATE terminal_sessions
				SET status = ?, ended_at = ?, updated_at = ?, metadata_json = ?
				WHERE id = ?`,
		)
		.run(status, endedAt, endedAt, metadataJson, id);
}

/** One terminal session that was still open when the app last quit. */
export interface RestorableTerminalSessionRow {
	cwd: string | null;
	id: string;
	metadataJson: string;
	title: string;
	workspaceId: string;
}

/**
 * Selects the sessions that were still 'created'/'running' at the previous
 * shutdown — the tabs open in the dock when the app was quit or crashed. Read on
 * startup BEFORE {@link markStaleRunningTerminalSessions} flips them to failed,
 * so their ids remain recoverable for the dock restore path.
 * @param database - Open SQLite connection.
 * @returns The rows for every session that was alive at last quit.
 */
export function selectRestorableTerminalSessionRows({
	database,
}: {
	database: DatabaseSync;
}): RestorableTerminalSessionRow[] {
	const rows = database
		.prepare(
			`SELECT id, workspace_id, title, cwd, metadata_json
				FROM terminal_sessions
				WHERE status IN ('created', 'running')`,
		)
		.all() as Array<Record<string, unknown>>;

	return rows.map((row) => ({
		cwd: typeof row.cwd === 'string' ? row.cwd : null,
		id: String(row.id),
		metadataJson:
			typeof row.metadata_json === 'string' ? row.metadata_json : '{}',
		title: String(row.title),
		workspaceId: String(row.workspace_id),
	}));
}

/** Inputs for {@link markStaleRunningTerminalSessions}. */
export interface MarkStaleRunningTerminalSessionsOptions {
	database: DatabaseSync;
	timestamp: string;
}

/**
 * Marks every 'created'/'running' row as failed. Called on startup so sessions
 * orphaned by a previous app crash do not appear alive after reload.
 */
export function markStaleRunningTerminalSessions({
	database,
	timestamp,
}: MarkStaleRunningTerminalSessionsOptions): void {
	database
		.prepare(
			`UPDATE terminal_sessions
				SET status = 'failed', ended_at = ?, updated_at = ?
				WHERE status IN ('created', 'running')`,
		)
		.run(timestamp, timestamp);
}
