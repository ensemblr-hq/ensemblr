import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { parseMetadata } from './metadata-json.ts';

/** One git-backed checkpoint captured before an agent user turn (ADR 0012). */
export interface CheckpointRow {
	agentSessionId: string | null;
	createdAt: string;
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
	gitHash: string;
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
	git_hash: string | null;
	git_ref: string;
	id: string;
	label: string;
	metadata_json: string;
	reason: string | null;
	turn_id: string | null;
	workspace_id: string;
}

const SELECT_CHECKPOINT = `SELECT id, workspace_id, agent_session_id, turn_id, git_ref, git_hash, label, reason, created_at, metadata_json
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

/** Returns all checkpoints for an agent session, oldest first. */
export function listCheckpointsForAgentSession({
	agentSessionId,
	database,
}: {
	agentSessionId: string;
	database: DatabaseSync;
}): readonly CheckpointRow[] {
	const rows = database
		.prepare(
			`${SELECT_CHECKPOINT} WHERE agent_session_id = ? ORDER BY created_at ASC`,
		)
		.all(agentSessionId) as unknown as CheckpointRowShape[];
	return rows.map(mapRow);
}

/**
 * Returns the next checkpoint in the same agent session after the given one
 * (by capture order), or `null` when it is the latest.
 */
export function getNextCheckpointInAgentSession({
	agentSessionId,
	checkpointId,
	database,
}: {
	agentSessionId: string;
	checkpointId: string;
	database: DatabaseSync;
}): CheckpointRow | null {
	const row = database
		.prepare(
			`${SELECT_CHECKPOINT}
			 WHERE agent_session_id = ?
			   AND (created_at, id) > (SELECT created_at, id FROM checkpoints WHERE id = ?)
			 ORDER BY created_at ASC, id ASC
			 LIMIT 1`,
		)
		.get(agentSessionId, checkpointId) as CheckpointRowShape | undefined;
	return row ? mapRow(row) : null;
}

/** Returns all checkpoints for a workspace, oldest first. */
export function listCheckpointsForWorkspace({
	database,
	workspaceId,
}: {
	database: DatabaseSync;
	workspaceId: string;
}): readonly CheckpointRow[] {
	const rows = database
		.prepare(
			`${SELECT_CHECKPOINT} WHERE workspace_id = ? ORDER BY created_at ASC`,
		)
		.all(workspaceId) as unknown as CheckpointRowShape[];
	return rows.map(mapRow);
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
