import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { PiPersistedEnvelope } from '../../../shared/ipc/contracts/pi-session';

export type PiEventStream = 'protocol' | 'stderr';

/**
 * Persisted payload type. The storage column itself accepts opaque JSON so
 * older rows or future variants don't fail to load, but Ensemble writers
 * always insert a {@link PiPersistedEnvelope}; a `null` only surfaces when the
 * stored JSON failed to parse or predates this contract.
 */
export type PiEventPayload = PiPersistedEnvelope | null;

export interface PiEventRow {
	branchId: string;
	createdAt: string;
	eventType: string;
	id: string;
	ordinal: number;
	payload: PiEventPayload;
	stream: PiEventStream;
	turnId: string | null;
}

export interface AppendPiEventInput {
	branchId: string;
	/**
	 * Wall-clock timestamp of the event (ISO 8601). Persisted verbatim so turn
	 * timing reflects when the runtime emitted the event, not when SQLite wrote
	 * the row. Falls back to the DB clock when omitted.
	 */
	createdAt?: string;
	eventType: string;
	payload?: PiEventPayload;
	stream?: PiEventStream;
	turnId?: string | null;
}

/** SQLite expression that stamps the DB clock when no `created_at` is supplied. */
const CREATED_AT_VALUE = `COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

interface EventRowShape {
	branch_id: string;
	created_at: string;
	event_type: string;
	id: string;
	ordinal: number;
	payload_json: string;
	stream: PiEventStream;
	turn_id: string | null;
}

const SELECT_EVENT = `SELECT id, branch_id, turn_id, ordinal, event_type, stream, payload_json, created_at
FROM pi_session_events`;

/**
 * Appends a single event to a branch with auto-incremented ordinal. Transaction
 * scoped so concurrent appenders don't allocate the same ordinal.
 */
export function appendPiEvent({
	database,
	input,
}: {
	database: DatabaseSync;
	input: AppendPiEventInput;
}): PiEventRow {
	const id = randomUUID();
	const stream: PiEventStream = input.stream ?? 'protocol';
	const payload = serializePayload(input.payload);

	database.exec('BEGIN IMMEDIATE');
	try {
		const next = database
			.prepare(
				`SELECT COALESCE(MAX(ordinal), -1) + 1 AS next FROM pi_session_events WHERE branch_id = ?`,
			)
			.get(input.branchId) as { next: number };

		database
			.prepare(
				`INSERT INTO pi_session_events
					(id, branch_id, turn_id, ordinal, event_type, stream, payload_json, created_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ${CREATED_AT_VALUE})`,
			)
			.run(
				id,
				input.branchId,
				input.turnId ?? null,
				next.next,
				input.eventType,
				stream,
				payload,
				input.createdAt ?? null,
			);

		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}

	const row = getEventById({ database, id });
	if (!row) {
		throw new Error('pi-event-repository: event insert did not round-trip');
	}
	return row;
}

/**
 * Appends many events in one transaction. Ordinal allocation reuses the same
 * `max + 1` seed and increments locally.
 */
export function appendPiEvents({
	database,
	branchId,
	events,
}: {
	branchId: string;
	database: DatabaseSync;
	events: readonly Omit<AppendPiEventInput, 'branchId'>[];
}): readonly PiEventRow[] {
	if (events.length === 0) {
		return [];
	}

	const insertedIds: string[] = [];
	database.exec('BEGIN IMMEDIATE');
	try {
		const next = database
			.prepare(
				`SELECT COALESCE(MAX(ordinal), -1) + 1 AS next FROM pi_session_events WHERE branch_id = ?`,
			)
			.get(branchId) as { next: number };

		const insertStatement = database.prepare(
			`INSERT INTO pi_session_events
				(id, branch_id, turn_id, ordinal, event_type, stream, payload_json, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ${CREATED_AT_VALUE})`,
		);

		events.forEach((event, index) => {
			const id = randomUUID();
			insertStatement.run(
				id,
				branchId,
				event.turnId ?? null,
				next.next + index,
				event.eventType,
				event.stream ?? 'protocol',
				serializePayload(event.payload),
				event.createdAt ?? null,
			);
			insertedIds.push(id);
		});

		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}

	return insertedIds.map((id) => {
		const row = getEventById({ database, id });
		if (!row) {
			throw new Error(
				'pi-event-repository: batch event insert did not round-trip',
			);
		}
		return row;
	});
}

/** Returns the event row, or `null` when no row matches. */
export function getEventById({
	database,
	id,
}: {
	database: DatabaseSync;
	id: string;
}): PiEventRow | null {
	const row = database.prepare(`${SELECT_EVENT} WHERE id = ?`).get(id) as
		| EventRowShape
		| undefined;

	return row ? mapEventRow(row) : null;
}

/** Returns the largest ordinal stored for a branch, or -1 when empty. */
export function getMaxOrdinalForBranch({
	database,
	branchId,
}: {
	database: DatabaseSync;
	branchId: string;
}): number {
	const row = database
		.prepare(
			`SELECT COALESCE(MAX(ordinal), -1) AS max FROM pi_session_events WHERE branch_id = ?`,
		)
		.get(branchId) as { max: number } | undefined;
	return row?.max ?? -1;
}

/** Returns events for a branch in ordinal order. */
export function listEventsByBranch({
	database,
	branchId,
	fromOrdinal,
	limit,
}: {
	branchId: string;
	database: DatabaseSync;
	fromOrdinal?: number;
	limit?: number;
}): readonly PiEventRow[] {
	const clauses: string[] = ['branch_id = ?'];
	const values: Array<number | string> = [branchId];

	if (typeof fromOrdinal === 'number') {
		clauses.push('ordinal >= ?');
		values.push(fromOrdinal);
	}

	const limitClause = typeof limit === 'number' ? ' LIMIT ?' : '';
	if (typeof limit === 'number') {
		values.push(limit);
	}

	const rows = database
		.prepare(
			`${SELECT_EVENT} WHERE ${clauses.join(' AND ')} ORDER BY ordinal ASC${limitClause}`,
		)
		.all(...values) as unknown as EventRowShape[];

	return rows.map(mapEventRow);
}

/** Returns events tied to a specific turn in ordinal order. */
export function listEventsByTurn({
	database,
	turnId,
}: {
	database: DatabaseSync;
	turnId: string;
}): readonly PiEventRow[] {
	const rows = database
		.prepare(`${SELECT_EVENT} WHERE turn_id = ? ORDER BY ordinal ASC`)
		.all(turnId) as unknown as EventRowShape[];

	return rows.map(mapEventRow);
}

function mapEventRow(row: EventRowShape): PiEventRow {
	return {
		branchId: row.branch_id,
		createdAt: row.created_at,
		eventType: row.event_type,
		id: row.id,
		ordinal: row.ordinal,
		payload: parsePayload(row.payload_json),
		stream: row.stream,
		turnId: row.turn_id,
	};
}

function serializePayload(payload: PiEventPayload | undefined): string {
	if (payload === undefined) {
		return '{}';
	}
	try {
		return JSON.stringify(payload);
	} catch {
		return '{}';
	}
}

function parsePayload(raw: string): PiEventPayload {
	try {
		// The store accepts opaque JSON; callers always insert envelopes, so
		// the parsed shape matches `PiPersistedEnvelope` on the read path.
		return JSON.parse(raw) as PiEventPayload;
	} catch {
		return null;
	}
}
