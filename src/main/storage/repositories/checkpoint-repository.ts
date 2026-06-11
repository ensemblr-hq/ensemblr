import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** One git-backed checkpoint captured before a Pi user turn (ADR 0012). */
export interface CheckpointRow {
	createdAt: string;
	gitHash: string | null;
	gitRef: string;
	id: string;
	label: string;
	metadata: Record<string, unknown>;
	piSessionId: string | null;
	reason: string | null;
	turnId: string | null;
	workspaceId: string;
}

export interface InsertCheckpointInput {
	gitHash: string;
	gitRef: string;
	label: string;
	metadata?: Record<string, unknown>;
	piSessionId: string;
	reason?: string | null;
	turnId: string;
	workspaceId: string;
}

interface CheckpointRowShape {
	created_at: string;
	git_hash: string | null;
	git_ref: string;
	id: string;
	label: string;
	metadata_json: string;
	pi_session_id: string | null;
	reason: string | null;
	turn_id: string | null;
	workspace_id: string;
}

const SELECT_CHECKPOINT = `SELECT id, workspace_id, pi_session_id, turn_id, git_ref, git_hash, label, reason, created_at, metadata_json
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
			`INSERT INTO checkpoints (id, workspace_id, pi_session_id, turn_id, git_ref, git_hash, label, reason, metadata_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			id,
			input.workspaceId,
			input.piSessionId,
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

/** Returns the checkpoint captured for a Pi turn, or `null`. */
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

/** Returns all checkpoints for a Pi session, oldest first. */
export function listCheckpointsForPiSession({
	database,
	piSessionId,
}: {
	database: DatabaseSync;
	piSessionId: string;
}): readonly CheckpointRow[] {
	const rows = database
		.prepare(
			`${SELECT_CHECKPOINT} WHERE pi_session_id = ? ORDER BY created_at ASC`,
		)
		.all(piSessionId) as unknown as CheckpointRowShape[];
	return rows.map(mapRow);
}

/**
 * Returns the next checkpoint in the same Pi session after the given one
 * (by capture order), or `null` when it is the latest.
 */
export function getNextCheckpointInPiSession({
	checkpointId,
	database,
	piSessionId,
}: {
	checkpointId: string;
	database: DatabaseSync;
	piSessionId: string;
}): CheckpointRow | null {
	const row = database
		.prepare(
			`${SELECT_CHECKPOINT}
			 WHERE pi_session_id = ?
			   AND (created_at, id) > (SELECT created_at, id FROM checkpoints WHERE id = ?)
			 ORDER BY created_at ASC, id ASC
			 LIMIT 1`,
		)
		.get(piSessionId, checkpointId) as CheckpointRowShape | undefined;
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

function mapRow(row: CheckpointRowShape): CheckpointRow {
	return {
		createdAt: row.created_at,
		gitHash: row.git_hash,
		gitRef: row.git_ref,
		id: row.id,
		label: row.label,
		metadata: parseMetadata(row.metadata_json),
		piSessionId: row.pi_session_id,
		reason: row.reason,
		turnId: row.turn_id,
		workspaceId: row.workspace_id,
	};
}

function parseMetadata(raw: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// fall through to empty
	}
	return {};
}
