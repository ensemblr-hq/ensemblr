import { randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

import type { AgentPersistedEnvelope } from '../../../shared/ipc/contracts/agent-session';
import { rollbackQuietly } from '../tx.ts';
import { capPersistedPayload } from './agent-event-payload-cap.ts';

/** Source stream a persisted agent event came from: the protocol channel or stderr. */
export type AgentEventStream = 'protocol' | 'stderr';

/**
 * Persisted payload type. The storage column itself accepts opaque JSON so
 * older rows or future variants don't fail to load, but Ensemblr writers
 * always insert an {@link AgentPersistedEnvelope}; a `null` only surfaces when
 * the stored JSON failed to parse or predates this contract.
 */
type AgentEventPayload = AgentPersistedEnvelope | null;

/** Domain shape of a persisted agent session event returned by the repository. */
export interface AgentEventRow {
	branchId: string;
	createdAt: string;
	eventType: string;
	id: string;
	ordinal: number;
	payload: AgentEventPayload;
	stream: AgentEventStream;
	turnId: string | null;
}

/** Input for appending an agent session event to the event log. */
export interface AppendAgentEventInput {
	branchId: string;
	/**
	 * Wall-clock timestamp of the event (ISO 8601). Persisted verbatim so turn
	 * timing reflects when the runtime emitted the event, not when SQLite wrote
	 * the row. Falls back to the DB clock when omitted.
	 */
	createdAt?: string;
	eventType: string;
	payload?: AgentEventPayload;
	stream?: AgentEventStream;
	turnId?: string | null;
}

/** SQLite expression that stamps the DB clock when no `created_at` is supplied. */
const CREATED_AT_VALUE = `COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/** Raw agent event row shape with snake_case columns as stored in SQLite. */
interface EventRowShape {
	branch_id: string;
	created_at: string;
	event_type: string;
	id: string;
	ordinal: number;
	payload_json: string;
	stream: AgentEventStream;
	turn_id: string | null;
}

/** Projected row shape for the payload-only descending scan. */
interface EventPayloadRowShape {
	ordinal: number;
	payload_json: string;
}

const SELECT_EVENT = `SELECT id, branch_id, turn_id, ordinal, event_type, stream, payload_json, created_at
FROM agent_session_events`;

const SELECT_BRANCH_PAYLOADS_DESC = `SELECT ordinal, payload_json
FROM agent_session_events
WHERE branch_id = ?
ORDER BY ordinal DESC`;

/**
 * One append is one statement: the ordinal is allocated by a subquery inside
 * the `INSERT` — atomic on its own, and `UNIQUE(branch_id, ordinal)` is the
 * backstop — and `RETURNING` hands back the two columns SQLite owns, so no
 * `BEGIN`/`COMMIT` pair, no `MAX(ordinal)` probe, and no read-back `SELECT`.
 * The write path runs ~99,000 times a day on one developer's machine, and the
 * five statements it used to compile per event were all on the main thread.
 */
const INSERT_EVENT = `INSERT INTO agent_session_events
	(id, branch_id, turn_id, ordinal, event_type, stream, payload_json, created_at)
	VALUES (?, ?, ?, (SELECT COALESCE(MAX(ordinal), -1) + 1 FROM agent_session_events WHERE branch_id = ?), ?, ?, ?, ${CREATED_AT_VALUE})
	RETURNING ordinal, created_at`;

/**
 * Prepared statements are cached per connection rather than compiled per
 * append. Keyed weakly so the statements are released with the database.
 */
const insertStatementsByDatabase = new WeakMap<DatabaseSync, StatementSync>();

/** Columns `RETURNING` hands back from an event insert. */
interface InsertedEventShape {
	created_at: string;
	ordinal: number;
}

/**
 * Returns this connection's cached event-insert statement, compiling it once.
 * @param database - Open SQLite connection.
 * @returns The prepared insert.
 */
function insertEventStatement(database: DatabaseSync): StatementSync {
	const cached = insertStatementsByDatabase.get(database);
	if (cached) {
		return cached;
	}
	const prepared = database.prepare(INSERT_EVENT);
	insertStatementsByDatabase.set(database, prepared);
	return prepared;
}

/**
 * Inserts one event and returns the row as persisted, capping an oversized
 * payload first so the caller broadcasts exactly what landed on disk.
 * @param database - Open SQLite connection.
 * @param input - Event to append, with its branch resolved.
 * @returns The persisted row.
 */
function insertAgentEvent(
	database: DatabaseSync,
	input: AppendAgentEventInput,
): AgentEventRow {
	const id = randomUUID();
	const stream: AgentEventStream = input.stream ?? 'protocol';
	const payload = capPersistedPayload(input.payload ?? null);

	const inserted = insertEventStatement(database).get(
		id,
		input.branchId,
		input.turnId ?? null,
		input.branchId,
		input.eventType,
		stream,
		serializePayload(payload),
		input.createdAt ?? null,
	) as unknown as InsertedEventShape | undefined;

	if (!inserted) {
		throw new Error('agent-event-repository: event insert did not round-trip');
	}

	return {
		branchId: input.branchId,
		createdAt: inserted.created_at,
		eventType: input.eventType,
		id,
		ordinal: inserted.ordinal,
		payload,
		stream,
		turnId: input.turnId ?? null,
	};
}

/**
 * Appends a single event to a branch with auto-incremented ordinal. The ordinal
 * is allocated inside the insert, so the statement is atomic without an
 * explicit transaction.
 */
export function appendAgentEvent({
	database,
	input,
}: {
	database: DatabaseSync;
	input: AppendAgentEventInput;
}): AgentEventRow {
	return insertAgentEvent(database, input);
}

/**
 * Appends many events in one transaction, reusing the single cached insert so a
 * burst costs one commit instead of one per event.
 */
export function appendAgentEvents({
	database,
	branchId,
	events,
}: {
	branchId: string;
	database: DatabaseSync;
	events: readonly Omit<AppendAgentEventInput, 'branchId'>[];
}): readonly AgentEventRow[] {
	if (events.length === 0) {
		return [];
	}

	database.exec('BEGIN IMMEDIATE');
	try {
		const rows = events.map((event) =>
			insertAgentEvent(database, { ...event, branchId }),
		);
		database.exec('COMMIT');
		return rows;
	} catch (error) {
		rollbackQuietly(database);
		throw error;
	}
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
			`SELECT COALESCE(MAX(ordinal), -1) AS max FROM agent_session_events WHERE branch_id = ?`,
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
}): readonly AgentEventRow[] {
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

/** A window of a branch's newest events, plus whether older ones remain. */
export interface BranchEventTail {
	events: readonly AgentEventRow[];
	hasOlder: boolean;
}

/**
 * Reads the newest events of a branch in ordinal order, ending before
 * `beforeOrdinal` when paging back.
 *
 * Replay needs the *tail*, and the ordered read is ASC, so a bare `LIMIT n`
 * would return the oldest `n` — the wrong end of a 26,922-event branch, whose
 * unbounded read measured ~460 ms of blocked main thread and 13.5 MB across one
 * IPC reply. The window is taken DESC against `UNIQUE(branch_id, ordinal)` and
 * reversed in memory, and one extra row is read to answer `hasOlder` without a
 * second query.
 * @param params - Database, branch, exclusive upper ordinal bound, and window size.
 * @returns The window in ascending ordinal order, and whether older events remain.
 */
export function listBranchEventTail({
	database,
	branchId,
	beforeOrdinal,
	limit,
}: {
	beforeOrdinal?: number;
	branchId: string;
	database: DatabaseSync;
	limit: number;
}): BranchEventTail {
	const values: Array<number | string> = [branchId];
	const bound = typeof beforeOrdinal === 'number' ? ' AND ordinal < ?' : '';
	if (typeof beforeOrdinal === 'number') {
		values.push(beforeOrdinal);
	}
	values.push(limit + 1);

	const rows = database
		.prepare(
			`${SELECT_EVENT} WHERE branch_id = ?${bound} ORDER BY ordinal DESC LIMIT ?`,
		)
		.all(...values) as unknown as EventRowShape[];

	const hasOlder = rows.length > limit;
	const window = hasOlder ? rows.slice(0, limit) : rows;

	return { events: window.reverse().map(mapEventRow), hasOlder };
}

/**
 * Yields a branch's persisted payloads newest-first (descending ordinal),
 * parsing each row lazily so a caller scanning for the most recent matching
 * event stops reading as soon as it finds one instead of loading and parsing
 * the whole branch. Each yielded ordinal lets callers honor checkpoint hidden
 * ranges.
 * @param params - Database handle and the branch whose payloads to scan.
 * @returns A generator of `{ ordinal, payload }` in descending ordinal order.
 */
export function* iterateBranchPayloadsDescending({
	database,
	branchId,
}: {
	branchId: string;
	database: DatabaseSync;
}): Generator<{ ordinal: number; payload: AgentEventPayload }> {
	const rows = database
		.prepare(SELECT_BRANCH_PAYLOADS_DESC)
		.iterate(branchId) as unknown as IterableIterator<EventPayloadRowShape>;

	for (const row of rows) {
		yield { ordinal: row.ordinal, payload: parsePayload(row.payload_json) };
	}
}

/** Returns events tied to a specific turn in ordinal order. */
export function listEventsByTurn({
	database,
	turnId,
}: {
	database: DatabaseSync;
	turnId: string;
}): readonly AgentEventRow[] {
	const rows = database
		.prepare(`${SELECT_EVENT} WHERE turn_id = ? ORDER BY ordinal ASC`)
		.all(turnId) as unknown as EventRowShape[];

	return rows.map(mapEventRow);
}

/**
 * Map a raw agent event row to the domain {@link AgentEventRow}, parsing its payload JSON.
 * @param row - Raw SQLite row
 * @returns The domain agent event
 */
function mapEventRow(row: EventRowShape): AgentEventRow {
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

/**
 * Serialize an agent event payload to a JSON string, falling back to `{}` on missing or unserializable input.
 * @param payload - Event payload to serialize
 * @returns The JSON string, or `'{}'` when absent or serialization fails
 */
function serializePayload(payload: AgentEventPayload | undefined): string {
	if (payload === undefined || payload === null) {
		return '{}';
	}
	try {
		return JSON.stringify(payload);
	} catch {
		return '{}';
	}
}

/**
 * Parse a stored payload JSON string into an agent event payload, returning null when parsing fails.
 * @param raw - JSON string to parse
 * @returns The parsed payload, or null when the JSON is invalid
 */
function parsePayload(raw: string): AgentEventPayload {
	try {
		// The store accepts opaque JSON; callers always insert envelopes, so
		// the parsed shape matches `AgentPersistedEnvelope` on the read path.
		return JSON.parse(raw) as AgentEventPayload;
	} catch {
		return null;
	}
}
