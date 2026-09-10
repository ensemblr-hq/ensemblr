import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

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
 * Atomically checks and reserves lifetime and rolling spawn capacity.
 * @param input - Database, root-tree identity, clock values, and configured caps.
 * @returns The durable reservation id, or the exhausted budget.
 */
export function reserveAgentControlSpawn(input: {
	at: number;
	database: DatabaseSync;
	maxRecent: number;
	maxTotal: number;
	rootSessionId: string;
	windowStart: number;
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
			input.database.exec('ROLLBACK');
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
			input.database.exec('ROLLBACK');
			return { status: 'rate' };
		}
		const reservationId = randomUUID();
		input.database
			.prepare(
				'INSERT INTO agent_control_spawn_reservations (id, root_session_id, reserved_at) VALUES (?, ?, ?)',
			)
			.run(reservationId, input.rootSessionId, input.at);
		input.database.exec('COMMIT');
		return { reservationId, status: 'reserved' };
	} catch (error) {
		input.database.exec('ROLLBACK');
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
