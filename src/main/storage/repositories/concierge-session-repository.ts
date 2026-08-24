import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AgentProviderId } from '../../../shared/agent-provider.ts';
import type { AgentPersistedEnvelope } from '../../../shared/ipc/contracts/agent-session';
import { parseMetadata, serializeMetadata } from './metadata-json.ts';

/** Lifecycle status of a Concierge session, mirroring the agent-session vocabulary. */
export type ConciergeSessionStatus =
	| 'closed'
	| 'errored'
	| 'idle'
	| 'starting'
	| 'streaming';

/**
 * One Concierge conversation. Unlike an agent session it belongs to no
 * workspace: the Concierge sits above every project, so its only anchor is the
 * concierge home directory it runs in.
 */
export interface ConciergeSessionRow {
	closedAt: string | null;
	createdAt: string;
	cwd: string;
	executableId: string | null;
	executablePath: string | null;
	id: string;
	lastError: string | null;
	metadata: Record<string, unknown>;
	model: string | null;
	nextOrdinal: number;
	provider: AgentProviderId;
	runtimeSessionId: string | null;
	status: ConciergeSessionStatus;
	thinkingLevel: string | null;
	title: string;
	updatedAt: string;
}

/** Fields accepted when opening a Concierge session row. */
export interface CreateConciergeSessionInput {
	cwd: string;
	executableId?: string | null;
	executablePath?: string | null;
	metadata?: Record<string, unknown>;
	model?: string | null;
	provider: AgentProviderId;
	runtimeSessionId?: string | null;
	thinkingLevel?: string | null;
	title?: string;
}

/** Fields a Concierge session row accepts on update; absent keys are untouched. */
export interface UpdateConciergeSessionPatch {
	closedAt?: string | null;
	lastError?: string | null;
	metadata?: Record<string, unknown>;
	model?: string | null;
	runtimeSessionId?: string | null;
	status?: ConciergeSessionStatus;
	thinkingLevel?: string | null;
	title?: string;
}

/** Source stream a persisted Concierge event came from. */
export type ConciergeEventStream = 'protocol' | 'stderr';

/** One persisted event in a Concierge transcript. */
export interface ConciergeEventRow {
	createdAt: string;
	eventType: string;
	id: string;
	ordinal: number;
	payload: AgentPersistedEnvelope | null;
	sessionId: string;
	stream: ConciergeEventStream;
}

/** Input for appending one event to a Concierge transcript. */
export interface AppendConciergeEventInput {
	createdAt?: string;
	eventType: string;
	payload?: AgentPersistedEnvelope | null;
	sessionId: string;
	stream?: ConciergeEventStream;
}

/** Raw session row as stored, with snake_case columns. */
interface SessionRowShape {
	closed_at: string | null;
	created_at: string;
	cwd: string;
	executable_id: string | null;
	executable_path: string | null;
	id: string;
	last_error: string | null;
	metadata_json: string;
	model: string | null;
	next_ordinal: number;
	provider: string;
	runtime_session_id: string | null;
	status: ConciergeSessionStatus;
	thinking_level: string | null;
	title: string;
	updated_at: string;
}

/** Raw event row as stored, with snake_case columns. */
interface EventRowShape {
	created_at: string;
	event_type: string;
	id: string;
	ordinal: number;
	payload_json: string;
	session_id: string;
	stream: ConciergeEventStream;
}

const SELECT_SESSION = `SELECT id, provider, runtime_session_id, executable_id, executable_path,
	model, thinking_level, status, last_error, cwd, title, next_ordinal,
	created_at, updated_at, closed_at, metadata_json
FROM concierge_sessions`;

const SELECT_EVENT = `SELECT id, session_id, ordinal, event_type, stream, payload_json, created_at
FROM concierge_session_events`;

const CREATED_AT_VALUE = `COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/**
 * Maps a stored session row onto its domain shape.
 * @param row - Raw row read from SQLite.
 * @returns The session in camelCase, with metadata parsed.
 */
function toSessionRow(row: SessionRowShape): ConciergeSessionRow {
	return {
		closedAt: row.closed_at,
		createdAt: row.created_at,
		cwd: row.cwd,
		executableId: row.executable_id,
		executablePath: row.executable_path,
		id: row.id,
		lastError: row.last_error,
		metadata: parseMetadata(row.metadata_json),
		model: row.model,
		nextOrdinal: row.next_ordinal,
		provider: row.provider as AgentProviderId,
		runtimeSessionId: row.runtime_session_id,
		status: row.status,
		thinkingLevel: row.thinking_level,
		title: row.title,
		updatedAt: row.updated_at,
	};
}

/**
 * Maps a stored event row onto its domain shape, tolerating unparseable JSON.
 * @param row - Raw row read from SQLite.
 * @returns The event in camelCase, with a null payload when the JSON is corrupt.
 */
function toEventRow(row: EventRowShape): ConciergeEventRow {
	return {
		createdAt: row.created_at,
		eventType: row.event_type,
		id: row.id,
		ordinal: row.ordinal,
		payload: parsePayload(row.payload_json),
		sessionId: row.session_id,
		stream: row.stream,
	};
}

/**
 * Parses a stored event payload, returning null rather than throwing on corrupt
 * JSON so one bad row never makes a transcript unreadable.
 * @param raw - Stored JSON string.
 * @returns The parsed envelope, or null.
 */
function parsePayload(raw: string): AgentPersistedEnvelope | null {
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object'
			? (parsed as AgentPersistedEnvelope)
			: null;
	} catch {
		return null;
	}
}

/**
 * Opens a Concierge session row.
 * @param input - Database handle and the session fields to persist.
 * @returns The created session row.
 */
export function createConciergeSession({
	database,
	input,
}: {
	database: DatabaseSync;
	input: CreateConciergeSessionInput;
}): ConciergeSessionRow {
	const id = randomUUID();

	database
		.prepare(
			`INSERT INTO concierge_sessions
				(id, provider, runtime_session_id, executable_id, executable_path,
				 model, thinking_level, cwd, title, metadata_json)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			id,
			input.provider,
			input.runtimeSessionId ?? null,
			input.executableId ?? null,
			input.executablePath ?? null,
			input.model ?? null,
			input.thinkingLevel ?? null,
			input.cwd,
			input.title ?? '',
			serializeMetadata(input.metadata),
		);

	const created = getConciergeSessionById({ database, id });
	if (!created) {
		throw new Error(`Concierge session ${id} vanished after insert`);
	}
	return created;
}

/**
 * Reads one Concierge session by id.
 * @param database - Open SQLite connection.
 * @param id - Session row id.
 * @returns The session, or null when no row matches.
 */
export function getConciergeSessionById({
	database,
	id,
}: {
	database: DatabaseSync;
	id: string;
}): ConciergeSessionRow | null {
	const row = database.prepare(`${SELECT_SESSION} WHERE id = ?`).get(id) as
		| SessionRowShape
		| undefined;
	return row ? toSessionRow(row) : null;
}

/**
 * Lists Concierge sessions newest first.
 * @param database - Open SQLite connection.
 * @param includeClosed - Whether closed sessions are included.
 * @returns Matching sessions, most recently created first.
 */
export function listConciergeSessions({
	database,
	includeClosed = false,
}: {
	database: DatabaseSync;
	includeClosed?: boolean;
}): ConciergeSessionRow[] {
	const clause = includeClosed ? '' : ' WHERE closed_at IS NULL';
	return (
		database
			.prepare(`${SELECT_SESSION}${clause} ORDER BY created_at DESC`)
			.all() as unknown as SessionRowShape[]
	).map(toSessionRow);
}

/**
 * Reads the session the Concierge panel should reopen into: the newest one that
 * has not been closed.
 * @param database - Open SQLite connection.
 * @returns The active session, or null when every session is closed.
 */
export function getActiveConciergeSession({
	database,
}: {
	database: DatabaseSync;
}): ConciergeSessionRow | null {
	return listConciergeSessions({ database }).at(0) ?? null;
}

/**
 * Applies a partial update to a Concierge session, stamping `updated_at`.
 * @param input - Database handle, session id, and the fields to change.
 * @returns The updated session, or null when the id matches no row.
 */
export function updateConciergeSession({
	database,
	id,
	patch,
}: {
	database: DatabaseSync;
	id: string;
	patch: UpdateConciergeSessionPatch;
}): ConciergeSessionRow | null {
	const assignments: string[] = [];
	const values: (string | null)[] = [];

	const assign = (column: string, value: string | null): void => {
		assignments.push(`${column} = ?`);
		values.push(value);
	};

	if (patch.status !== undefined) {
		assign('status', patch.status);
	}
	if (patch.runtimeSessionId !== undefined) {
		assign('runtime_session_id', patch.runtimeSessionId);
	}
	if (patch.model !== undefined) {
		assign('model', patch.model);
	}
	if (patch.thinkingLevel !== undefined) {
		assign('thinking_level', patch.thinkingLevel);
	}
	if (patch.lastError !== undefined) {
		assign('last_error', patch.lastError);
	}
	if (patch.title !== undefined) {
		assign('title', patch.title);
	}
	if (patch.closedAt !== undefined) {
		assign('closed_at', patch.closedAt);
	}
	if (patch.metadata !== undefined) {
		assign('metadata_json', serializeMetadata(patch.metadata));
	}

	if (assignments.length === 0) {
		return getConciergeSessionById({ database, id });
	}

	assignments.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`);
	database
		.prepare(
			`UPDATE concierge_sessions SET ${assignments.join(', ')} WHERE id = ?`,
		)
		.run(...values, id);

	return getConciergeSessionById({ database, id });
}

/**
 * Appends one event to a Concierge transcript, allocating its ordinal inside the
 * same transaction so concurrent appenders cannot collide.
 * @param input - Database handle and the event to append.
 * @returns The persisted event row.
 */
export function appendConciergeEvent({
	database,
	input,
}: {
	database: DatabaseSync;
	input: AppendConciergeEventInput;
}): ConciergeEventRow {
	const id = randomUUID();
	const payload = input.payload ? JSON.stringify(input.payload) : '{}';

	database.exec('BEGIN IMMEDIATE');
	try {
		const next = database
			.prepare(
				`SELECT COALESCE(MAX(ordinal), -1) + 1 AS next FROM concierge_session_events WHERE session_id = ?`,
			)
			.get(input.sessionId) as { next: number };

		database
			.prepare(
				`INSERT INTO concierge_session_events
					(id, session_id, ordinal, event_type, stream, payload_json, created_at)
					VALUES (?, ?, ?, ?, ?, ?, ${CREATED_AT_VALUE})`,
			)
			.run(
				id,
				input.sessionId,
				next.next,
				input.eventType,
				input.stream ?? 'protocol',
				payload,
				input.createdAt ?? null,
			);

		database
			.prepare(
				`UPDATE concierge_sessions
					SET next_ordinal = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
					WHERE id = ?`,
			)
			.run(next.next + 1, input.sessionId);

		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}

	const row = database.prepare(`${SELECT_EVENT} WHERE id = ?`).get(id) as
		| EventRowShape
		| undefined;
	if (!row) {
		throw new Error(`Concierge event ${id} vanished after insert`);
	}
	return toEventRow(row);
}

/**
 * Reads a Concierge transcript in order, optionally from an ordinal onward so a
 * reconnecting renderer replays only what it is missing.
 * @param input - Database handle, session id, and an optional starting ordinal.
 * @returns The matching events, oldest first.
 */
export function listConciergeEvents({
	database,
	fromOrdinal = 0,
	sessionId,
}: {
	database: DatabaseSync;
	fromOrdinal?: number;
	sessionId: string;
}): ConciergeEventRow[] {
	return (
		database
			.prepare(
				`${SELECT_EVENT} WHERE session_id = ? AND ordinal >= ? ORDER BY ordinal ASC`,
			)
			.all(sessionId, fromOrdinal) as unknown as EventRowShape[]
	).map(toEventRow);
}
