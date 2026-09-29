import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { parseMetadata } from './metadata-json.ts';

/**
 * One git-backed checkpoint captured before an agent user turn (ADR 0012),
 * with the snapshot that closed that turn once it ended.
 */
export interface CheckpointRow {
	agentSessionId: string | null;
	createdAt: string;
	/** When the turn ended, or null while it runs (and on rows from before ends were kept). */
	endedAt: string | null;
	/** Commit the turn ended at; its diff is locked to `gitHash..endGitHash`. */
	endGitHash: string | null;
	endGitRef: string | null;
	gitHash: string | null;
	gitRef: string;
	id: string;
	label: string;
	metadata: Record<string, unknown>;
	reason: string | null;
	turnId: string | null;
	workspaceId: string;
}

/** Input for inserting a new checkpoint row. */
interface InsertCheckpointInput {
	agentSessionId: string;
	/** Null records a capture that failed, so the turn reads as lost rather than pending. */
	gitHash: string | null;
	gitRef: string;
	label: string;
	metadata?: Record<string, unknown>;
	reason?: string | null;
	turnId: string;
	workspaceId: string;
}

/** Raw `checkpoints` row shape with snake_case columns as stored in SQLite. */
interface CheckpointRowShape {
	agent_session_id: string | null;
	created_at: string;
	end_git_hash: string | null;
	end_git_ref: string | null;
	ended_at: string | null;
	git_hash: string | null;
	git_ref: string;
	id: string;
	label: string;
	metadata_json: string;
	reason: string | null;
	turn_id: string | null;
	workspace_id: string;
}

const SELECT_CHECKPOINT = `SELECT id, workspace_id, agent_session_id, turn_id, git_ref, git_hash, label, reason, created_at, metadata_json,
	end_git_hash, end_git_ref, ended_at
FROM checkpoints`;

/** Persists a captured checkpoint row. */
export function insertCheckpoint({
	database,
	input,
}: {
	database: DatabaseSync;
	input: InsertCheckpointInput;
}): CheckpointRow {
	const id = randomUUID();
	database
		.prepare(
			`INSERT INTO checkpoints (id, workspace_id, agent_session_id, turn_id, git_ref, git_hash, label, reason, metadata_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			id,
			input.workspaceId,
			input.agentSessionId,
			input.turnId,
			input.gitRef,
			input.gitHash,
			input.label,
			input.reason ?? null,
			JSON.stringify(input.metadata ?? {}),
		);

	const row = getCheckpointById({ database, id });
	if (!row) {
		throw new Error('checkpoint-repository: insert did not round-trip');
	}
	return row;
}

/** Returns a checkpoint by id, or `null`. */
export function getCheckpointById({
	database,
	id,
}: {
	database: DatabaseSync;
	id: string;
}): CheckpointRow | null {
	const row = database.prepare(`${SELECT_CHECKPOINT} WHERE id = ?`).get(id) as
		| CheckpointRowShape
		| undefined;
	return row ? mapRow(row) : null;
}

/** Returns the checkpoint captured for an agent turn, or `null`. */
export function getCheckpointByTurnId({
	database,
	turnId,
}: {
	database: DatabaseSync;
	turnId: string;
}): CheckpointRow | null {
	const row = database
		.prepare(`${SELECT_CHECKPOINT} WHERE turn_id = ?`)
		.get(turnId) as CheckpointRowShape | undefined;
	return row ? mapRow(row) : null;
}

/**
 * Records the snapshot a turn ended at, locking its diff range. Writes nothing
 * when the turn has no checkpoint row, since a turn that never captured its
 * start has no range to close.
 * @returns Whether a checkpoint row took the end
 */
export function setCheckpointEnd({
	database,
	endedAt,
	gitHash,
	gitRef,
	turnId,
}: {
	database: DatabaseSync;
	endedAt: string;
	gitHash: string;
	gitRef: string;
	turnId: string;
}): boolean {
	const result = database
		.prepare(
			`UPDATE checkpoints SET end_git_hash = ?, end_git_ref = ?, ended_at = ? WHERE turn_id = ?`,
		)
		.run(gitHash, gitRef, endedAt, turnId);
	return Number(result.changes) > 0;
}

/**
 * Records that a turn ended but its end snapshot was lost, so its range is
 * withheld for good rather than read as an end still being written. Leaves a
 * recorded end alone.
 * @returns Whether the turn's end changed
 */
export function markCheckpointEndFailed({
	database,
	endedAt,
	turnId,
}: {
	database: DatabaseSync;
	endedAt: string;
	turnId: string;
}): boolean {
	const result = database
		.prepare(
			`UPDATE checkpoints SET ended_at = ? WHERE turn_id = ? AND end_git_hash IS NULL AND ended_at IS NULL`,
		)
		.run(endedAt, turnId);
	return Number(result.changes) > 0;
}

/**
 * Forgets a turn's end because the runtime resumed it: what looked like the
 * turn settling was only a pause before it drained queued input.
 * @returns Whether a recorded or lost end was dropped
 */
export function clearCheckpointEnd({
	database,
	turnId,
}: {
	database: DatabaseSync;
	turnId: string;
}): boolean {
	const result = database
		.prepare(
			`UPDATE checkpoints SET end_git_hash = NULL, end_git_ref = NULL, ended_at = NULL
			 WHERE turn_id = ? AND ended_at IS NOT NULL`,
		)
		.run(turnId);
	return Number(result.changes) > 0;
}

/**
 * Deletes a turn's checkpoint row. For a turn whose input the runtime refused:
 * it never ran, so it must not stand as the next turn's successor.
 * @returns Whether a row was deleted
 */
export function deleteCheckpointForTurn({
	database,
	turnId,
}: {
	database: DatabaseSync;
	turnId: string;
}): boolean {
	const result = database
		.prepare('DELETE FROM checkpoints WHERE turn_id = ?')
		.run(turnId);
	return Number(result.changes) > 0;
}

/** One agent turn of a workspace, paired with the checkpoint captured before it. */
export interface TurnCheckpointRow {
	agentSessionId: string;
	/** Null when capture failed, was skipped, or has not landed yet. */
	checkpoint: CheckpointRow | null;
	/** Whether the turn row says it ended: completed, aborted, or errored. */
	settled: boolean;
	/** When the turn row settled, or null while it is open (and on older rows). */
	settledAt: string | null;
	turnId: string;
}

/** Raw row of the turn/checkpoint join, checkpoint columns null when the turn has none. */
interface TurnCheckpointRowShape {
	agent_session_id: string;
	checkpoint_agent_session_id: string | null;
	created_at: string | null;
	end_git_hash: string | null;
	end_git_ref: string | null;
	ended_at: string | null;
	git_hash: string | null;
	git_ref: string | null;
	id: string | null;
	label: string | null;
	metadata_json: string | null;
	reason: string | null;
	turn_completed_at: string | null;
	turn_id: string;
	turn_status: string;
	workspace_id: string | null;
}

/**
 * Returns every agent turn in a workspace with the checkpoint captured before
 * it, each session's turns in submission order. Turns without a checkpoint are
 * kept, since a later turn whose opening has not landed is what tells an
 * earlier one its range is still being closed — except a refused input's turn,
 * errored with its checkpoint discarded, which never ran and ends nothing.
 */
export function listTurnCheckpointsForWorkspace({
	database,
	workspaceId,
}: {
	database: DatabaseSync;
	workspaceId: string;
}): readonly TurnCheckpointRow[] {
	const rows = database
		.prepare(
			`SELECT t.id AS turn_id, t.status AS turn_status, t.completed_at AS turn_completed_at, b.agent_session_id,
				c.id, c.workspace_id, c.agent_session_id AS checkpoint_agent_session_id,
				c.git_ref, c.git_hash, c.label, c.reason, c.created_at, c.metadata_json,
				c.end_git_hash, c.end_git_ref, c.ended_at
			 FROM agent_turns t
			 JOIN agent_session_branches b ON b.id = t.branch_id
			 JOIN agent_sessions s ON s.id = b.agent_session_id
			 LEFT JOIN checkpoints c ON c.turn_id = t.id
			 WHERE s.workspace_id = ?
			   AND NOT (t.status = 'errored' AND c.id IS NULL)
			 ORDER BY b.agent_session_id ASC, t.submitted_at ASC, t.ordinal ASC, t.id ASC`,
		)
		.all(workspaceId) as unknown as TurnCheckpointRowShape[];
	return rows.map((row) => ({
		agentSessionId: row.agent_session_id,
		checkpoint: mapJoinedCheckpoint(row),
		settled: SETTLED_TURN_STATUSES.has(row.turn_status),
		settledAt: row.turn_completed_at,
		turnId: row.turn_id,
	}));
}

/** Turn statuses that mean the turn has ended. */
const SETTLED_TURN_STATUSES: ReadonlySet<string> = new Set([
	'aborted',
	'completed',
	'errored',
]);

/**
 * Reads the checkpoint half of a turn/checkpoint join row.
 * @param row - The joined row
 * @returns The checkpoint, or null when the turn has none
 */
function mapJoinedCheckpoint(
	row: TurnCheckpointRowShape,
): CheckpointRow | null {
	if (
		row.id === null ||
		row.workspace_id === null ||
		row.git_ref === null ||
		row.label === null ||
		row.created_at === null
	) {
		return null;
	}
	return mapRow({
		agent_session_id: row.checkpoint_agent_session_id,
		created_at: row.created_at,
		end_git_hash: row.end_git_hash,
		end_git_ref: row.end_git_ref,
		ended_at: row.ended_at,
		git_hash: row.git_hash,
		git_ref: row.git_ref,
		id: row.id,
		label: row.label,
		metadata_json: row.metadata_json ?? '{}',
		reason: row.reason,
		turn_id: row.turn_id,
		workspace_id: row.workspace_id,
	});
}

/**
 * Map a raw `checkpoints` row to the domain {@link CheckpointRow}, parsing its metadata JSON.
 * @param row - Raw SQLite row
 * @returns The domain checkpoint
 */
function mapRow(row: CheckpointRowShape): CheckpointRow {
	return {
		agentSessionId: row.agent_session_id,
		createdAt: row.created_at,
		endedAt: row.ended_at,
		endGitHash: row.end_git_hash,
		endGitRef: row.end_git_ref,
		gitHash: row.git_hash,
		gitRef: row.git_ref,
		id: row.id,
		label: row.label,
		metadata: parseMetadata(row.metadata_json),
		reason: row.reason,
		turnId: row.turn_id,
		workspaceId: row.workspace_id,
	};
}
