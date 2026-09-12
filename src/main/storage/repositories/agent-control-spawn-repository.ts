import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { rollbackQuietly } from '../tx.ts';

/** Outcome of atomically reserving one durable root-tree spawn slot. */
export type AgentControlSpawnReservationResult =
	| { status: 'quota' | 'rate' }
	| { reservationId: string; status: 'reserved' };

/** Reads a SQLite count projection while rejecting an unexpected row shape. */
function readCount(row: unknown): number {
	return typeof row === 'object' &&
		row !== null &&
		'count' in row &&
		typeof row.count === 'number'
		? row.count
		: 0;
}

/**
 * Resolves the workspace a reservation may be attributed to, so an id naming no
 * row is stored as `NULL` instead of violating the foreign key.
 * @param database - Open connection to read `workspaces` from.
 * @param workspaceId - Candidate workspace id from the calling origin, when any.
 * @returns The id when a workspace row holds it, else null.
 */
function resolveAttributableWorkspace(
	database: DatabaseSync,
	workspaceId: string | undefined,
): string | null {
	if (!workspaceId) {
		return null;
	}

	const row = database
		.prepare('SELECT 1 AS present FROM workspaces WHERE id = ?')
		.get(workspaceId);

	return row ? workspaceId : null;
}

/**
 * Atomically checks and reserves lifetime and rolling spawn capacity.
 *
 * `workspaceId` is what eventually clears the row: it foreign-keys
 * `workspaces(id)` with `ON DELETE CASCADE`, so a reservation outlives the
 * session that made it — quota is deliberately charged for the tree's lifetime
 * — but not the workspace it was spent in. Omitting it leaves the row
 * permanent, which is what rows written before migration 031 are.
 *
 * An id naming no workspace row is stored as `NULL` rather than refused. Not
 * every caller has a workspace: the Concierge's origin carries an empty id, and
 * a harness can register before its workspace row is committed. A foreign-key
 * violation there would fail the spawn itself, turning a bookkeeping nicety into
 * a refusal to delegate, so attribution fails open and the row stays permanent.
 * @param input - Database, root-tree identity, owning workspace, clock values, and configured caps.
 * @returns The durable reservation id, or the exhausted budget.
 */
export function reserveAgentControlSpawn(input: {
	at: number;
	database: DatabaseSync;
	maxRecent: number;
	maxTotal: number;
	rootSessionId: string;
	windowStart: number;
	workspaceId?: string;
}): AgentControlSpawnReservationResult {
	input.database.exec('BEGIN IMMEDIATE');
	try {
		const total = readCount(
			input.database
				.prepare(
					'SELECT COUNT(*) AS count FROM agent_control_spawn_reservations WHERE root_session_id = ?',
				)
				.get(input.rootSessionId),
		);
		if (total >= input.maxTotal) {
			rollbackQuietly(input.database);
			return { status: 'quota' };
		}
		const recent = readCount(
			input.database
				.prepare(
					'SELECT COUNT(*) AS count FROM agent_control_spawn_reservations WHERE root_session_id = ? AND reserved_at >= ?',
				)
				.get(input.rootSessionId, input.windowStart),
		);
		if (recent >= input.maxRecent) {
			rollbackQuietly(input.database);
			return { status: 'rate' };
		}
		const reservationId = randomUUID();
		input.database
			.prepare(
				'INSERT INTO agent_control_spawn_reservations (id, root_session_id, workspace_id, reserved_at) VALUES (?, ?, ?, ?)',
			)
			.run(
				reservationId,
				input.rootSessionId,
				resolveAttributableWorkspace(input.database, input.workspaceId),
				input.at,
			);
		input.database.exec('COMMIT');
		return { reservationId, status: 'reserved' };
	} catch (error) {
		rollbackQuietly(input.database);
		throw error;
	}
}

/**
 * Refunds one failed spawn creation by deleting only its durable reservation.
 * @param input - Database and reservation id returned by the reserve call.
 */
export function refundAgentControlSpawn(input: {
	database: DatabaseSync;
	reservationId: string;
}): void {
	input.database
		.prepare('DELETE FROM agent_control_spawn_reservations WHERE id = ?')
		.run(input.reservationId);
}
