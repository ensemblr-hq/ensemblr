import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
	type AgentProviderId,
	DEFAULT_AGENT_PROVIDER,
	normalizeAgentProviderId,
} from '../../../shared/agent-provider.ts';
import type { AgentSessionStatusWire } from '../../../shared/ipc/contracts/agent-message-payloads';
import { parseMetadata, serializeMetadata } from './metadata-json.ts';

/** Lifecycle status of a persisted agent session, mirrored from the IPC wire type. */
export type AgentSessionStatusValue = AgentSessionStatusWire;

/** Kind of an agent session branch: the primary line, a retry, or a fork. */
export type AgentSessionBranchKind = 'main' | 'retry' | 'fork';

/** Lifecycle status of a single prompt turn within an agent session. */
export type AgentTurnStatus =
	| 'submitted'
	| 'streaming'
	| 'completed'
	| 'aborted'
	| 'errored';

/** Domain-shaped agent session record returned by the repository. */
export interface AgentSessionRow {
	/**
	 * Session id the agent runtime knows this conversation by — the value handed
	 * to the CLI as `--session-id`, not the Ensemblr row `id` other tables
	 * foreign-key against. Null until the runtime reports one.
	 */
	runtimeSessionId: string | null;
	closedAt: string | null;
	createdAt: string;
	cwd: string;
	executableId: string | null;
	executablePath: string | null;
	id: string;
	label: string | null;
	lastError: string | null;
	metadata: Record<string, unknown>;
	model: string | null;
	/** Agent runtime this session is pinned to; every pre-Claude row reads as `pi`. */
	provider: AgentProviderId;
	status: AgentSessionStatusValue;
	thinkingLevel: string | null;
	updatedAt: string;
	workspaceId: string;
}

/** Domain-shaped agent session branch record returned by the repository. */
export interface AgentSessionBranchRow {
	agentSessionId: string;
	createdAt: string;
	forkedFromTurnId: string | null;
	id: string;
	kind: AgentSessionBranchKind;
	label: string | null;
	metadata: Record<string, unknown>;
	parentBranchId: string | null;
}

/** Domain-shaped agent turn record returned by the repository. */
export interface AgentTurnRow {
	branchId: string;
	completedAt: string | null;
	id: string;
	model: string | null;
	ordinal: number;
	promptText: string;
	status: AgentTurnStatus;
	submittedAt: string;
	thinkingLevel: string | null;
	turnMetadata: Record<string, unknown>;
}

/** Fields required to create a new agent session and its main branch. */
export interface CreateAgentSessionInput {
	/** Runtime-native session id, when the caller already knows it. */
	runtimeSessionId?: string | null;
	cwd: string;
	executableId?: string | null;
	executablePath?: string | null;
	label?: string | null;
	metadata?: Record<string, unknown>;
	model?: string | null;
	/** Agent runtime to pin the session to. Defaults to Pi. */
	provider?: AgentProviderId;
	thinkingLevel?: string | null;
	workspaceId: string;
}

/** Result of creating an agent session: the session row and its main branch. */
export interface CreateAgentSessionResult {
	mainBranch: AgentSessionBranchRow;
	session: AgentSessionRow;
}

/** Partial fields to update on an existing agent session. */
export interface UpdateAgentSessionPatch {
	runtimeSessionId?: string | null;
	closedAt?: string | null;
	lastError?: string | null;
	model?: string | null;
	status?: AgentSessionStatusValue;
	thinkingLevel?: string | null;
}

/** Fields required to append a new prompt turn to a branch. */
export interface CreateAgentTurnInput {
	branchId: string;
	model?: string | null;
	promptText: string;
	thinkingLevel?: string | null;
	turnMetadata?: Record<string, unknown>;
}

/** Partial fields to update on an existing agent turn. */
export interface UpdateAgentTurnPatch {
	completedAt?: string | null;
	status?: AgentTurnStatus;
	turnMetadata?: Record<string, unknown>;
}

/** Raw snake_case column shape of an `agent_sessions` row as read from SQLite. */
interface SessionRowShape {
	runtime_session_id: string | null;
	closed_at: string | null;
	created_at: string;
	cwd: string;
	executable_id: string | null;
	executable_path: string | null;
	id: string;
	label: string | null;
	last_error: string | null;
	metadata_json: string;
	model: string | null;
	provider: string;
	status: AgentSessionStatusValue;
	thinking_level: string | null;
	updated_at: string;
	workspace_id: string;
}

/** Raw snake_case column shape of an `agent_session_branches` row as read from SQLite. */
interface BranchRowShape {
	agent_session_id: string;
	created_at: string;
	forked_from_turn_id: string | null;
	id: string;
	kind: AgentSessionBranchKind;
	label: string | null;
	metadata_json: string;
	parent_branch_id: string | null;
}

/** Raw snake_case column shape of an `agent_turns` row as read from SQLite. */
interface TurnRowShape {
	branch_id: string;
	completed_at: string | null;
	id: string;
	model: string | null;
	ordinal: number;
	prompt_text: string;
	status: AgentTurnStatus;
	submitted_at: string;
	thinking_level: string | null;
	turn_metadata_json: string;
}

const SELECT_SESSION = `SELECT id, workspace_id, runtime_session_id, executable_id, executable_path,
  model, thinking_level, provider, status, last_error, cwd, label, created_at, updated_at, closed_at, metadata_json
FROM agent_sessions`;

const SELECT_BRANCH = `SELECT id, agent_session_id, parent_branch_id, forked_from_turn_id, kind, label, created_at, metadata_json
FROM agent_session_branches`;

const SELECT_TURN = `SELECT id, branch_id, ordinal, status, prompt_text, model, thinking_level, submitted_at, completed_at, turn_metadata_json
FROM agent_turns`;

/**
 * Creates an agent session row plus an initial `main` branch in a single
 * transaction so callers never observe a session without a branch.
 */
export function createAgentSession({
	database,
	input,
}: {
	database: DatabaseSync;
	input: CreateAgentSessionInput;
}): CreateAgentSessionResult {
	const sessionId = randomUUID();
	const branchId = randomUUID();
	const metadata = serializeMetadata(input.metadata);

	database.exec('BEGIN IMMEDIATE');
	try {
		database
			.prepare(
				`INSERT INTO agent_sessions (
					id, workspace_id, runtime_session_id, executable_id, executable_path,
					model, thinking_level, provider, status, cwd, label, metadata_json
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?, ?)`,
			)
			.run(
				sessionId,
				input.workspaceId,
				input.runtimeSessionId ?? null,
				input.executableId ?? null,
				input.executablePath ?? null,
				input.model ?? null,
				input.thinkingLevel ?? null,
				input.provider ?? DEFAULT_AGENT_PROVIDER,
				input.cwd,
				input.label ?? null,
				metadata,
			);

		database
			.prepare(
				`INSERT INTO agent_session_branches (id, agent_session_id, kind)
				 VALUES (?, ?, 'main')`,
			)
			.run(branchId, sessionId);

		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}

	const session = getAgentSessionById({ database, id: sessionId });
	const mainBranch = getAgentSessionBranchById({ database, id: branchId });

	if (!session || !mainBranch) {
		throw new Error(
			'agent-session-repository: failed to read back inserted rows',
		);
	}

	return { mainBranch, session };
}

/** Returns the session row, or `null` when no row matches. */
export function getAgentSessionById({
	database,
	id,
}: {
	database: DatabaseSync;
	id: string;
}): AgentSessionRow | null {
	const row = database.prepare(`${SELECT_SESSION} WHERE id = ?`).get(id) as
		| SessionRowShape
		| undefined;

	return row ? mapSessionRow(row) : null;
}

/** Returns the open sessions for the workspace, most recently updated first. */
export function listAgentSessionsByWorkspace({
	database,
	workspaceId,
}: {
	database: DatabaseSync;
	workspaceId: string;
}): readonly AgentSessionRow[] {
	const rows = database
		.prepare(
			`${SELECT_SESSION} WHERE workspace_id = ? ORDER BY updated_at DESC`,
		)
		.all(workspaceId) as unknown as SessionRowShape[];

	return rows.map(mapSessionRow);
}

/** Patches one or more mutable session fields and bumps `updated_at`. */
export function updateAgentSession({
	database,
	id,
	patch,
}: {
	database: DatabaseSync;
	id: string;
	patch: UpdateAgentSessionPatch;
}): AgentSessionRow | null {
	const fields: string[] = [];
	const values: Array<string | null> = [];

	if ('status' in patch && patch.status !== undefined) {
		fields.push('status = ?');
		values.push(patch.status);
	}
	if ('runtimeSessionId' in patch) {
		fields.push('runtime_session_id = ?');
		values.push(patch.runtimeSessionId ?? null);
	}
	if ('model' in patch) {
		fields.push('model = ?');
		values.push(patch.model ?? null);
	}
	if ('thinkingLevel' in patch) {
		fields.push('thinking_level = ?');
		values.push(patch.thinkingLevel ?? null);
	}
	if ('lastError' in patch) {
		fields.push('last_error = ?');
		values.push(patch.lastError ?? null);
	}
	if ('closedAt' in patch) {
		fields.push('closed_at = ?');
		values.push(patch.closedAt ?? null);
	}

	if (fields.length === 0) {
		return getAgentSessionById({ database, id });
	}

	fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");

	database
		.prepare(`UPDATE agent_sessions SET ${fields.join(', ')} WHERE id = ?`)
		.run(...values, id);

	return getAgentSessionById({ database, id });
}

/** Returns the branch row, or `null` when no row matches. */
export function getAgentSessionBranchById({
	database,
	id,
}: {
	database: DatabaseSync;
	id: string;
}): AgentSessionBranchRow | null {
	const row = database.prepare(`${SELECT_BRANCH} WHERE id = ?`).get(id) as
		| BranchRowShape
		| undefined;

	return row ? mapBranchRow(row) : null;
}

/** Returns all branches for a session in creation order. */
export function listAgentSessionBranches({
	agentSessionId,
	database,
}: {
	agentSessionId: string;
	database: DatabaseSync;
}): readonly AgentSessionBranchRow[] {
	const rows = database
		.prepare(
			`${SELECT_BRANCH} WHERE agent_session_id = ? ORDER BY created_at ASC`,
		)
		.all(agentSessionId) as unknown as BranchRowShape[];

	return rows.map(mapBranchRow);
}

/**
 * Returns the canonical `main` branch for a session, falling back to the
 * first branch in creation order when no explicit `main` exists. Returns
 * `null` when the session has no branches at all.
 */
export function getMainBranchForSession({
	agentSessionId,
	database,
}: {
	agentSessionId: string;
	database: DatabaseSync;
}): AgentSessionBranchRow | null {
	const branches = listAgentSessionBranches({ agentSessionId, database });
	return (
		branches.find((branch) => branch.kind === 'main') ?? branches[0] ?? null
	);
}

/** Creates a retry or fork branch from a parent. */
export function createBranch({
	agentSessionId,
	database,
	forkedFromTurnId = null,
	kind,
	label = null,
	metadata,
	parentBranchId,
}: {
	agentSessionId: string;
	database: DatabaseSync;
	forkedFromTurnId?: string | null;
	kind: AgentSessionBranchKind;
	label?: string | null;
	metadata?: Record<string, unknown>;
	parentBranchId: string;
}): AgentSessionBranchRow {
	const id = randomUUID();
	database
		.prepare(
			`INSERT INTO agent_session_branches
				(id, agent_session_id, parent_branch_id, forked_from_turn_id, kind, label, metadata_json)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			id,
			agentSessionId,
			parentBranchId,
			forkedFromTurnId,
			kind,
			label,
			serializeMetadata(metadata),
		);

	const row = getAgentSessionBranchById({ database, id });
	if (!row) {
		throw new Error(
			'agent-session-repository: branch insert did not round-trip',
		);
	}
	return row;
}

/**
 * Appends a new turn to the branch with auto-incremented ordinal. Wrapped in
 * a transaction so concurrent callers can't allocate the same ordinal.
 */
export function createTurn({
	database,
	input,
}: {
	database: DatabaseSync;
	input: CreateAgentTurnInput;
}): AgentTurnRow {
	const id = randomUUID();
	const metadata = serializeMetadata(input.turnMetadata);

	database.exec('BEGIN IMMEDIATE');
	try {
		const next = database
			.prepare(
				`SELECT COALESCE(MAX(ordinal), -1) + 1 AS next FROM agent_turns WHERE branch_id = ?`,
			)
			.get(input.branchId) as { next: number };

		database
			.prepare(
				`INSERT INTO agent_turns
					(id, branch_id, ordinal, status, prompt_text, model, thinking_level, turn_metadata_json)
					VALUES (?, ?, ?, 'submitted', ?, ?, ?, ?)`,
			)
			.run(
				id,
				input.branchId,
				next.next,
				input.promptText,
				input.model ?? null,
				input.thinkingLevel ?? null,
				metadata,
			);

		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}

	const row = getTurnById({ database, id });
	if (!row) {
		throw new Error('agent-session-repository: turn insert did not round-trip');
	}
	return row;
}

/** Replaces a branch's JSON metadata blob. */
export function setBranchMetadata({
	database,
	id,
	metadata,
}: {
	database: DatabaseSync;
	id: string;
	metadata: Record<string, unknown>;
}): void {
	database
		.prepare(`UPDATE agent_session_branches SET metadata_json = ? WHERE id = ?`)
		.run(serializeMetadata(metadata), id);
}

/** Returns the turn row, or `null` when no row matches. */
export function getTurnById({
	database,
	id,
}: {
	database: DatabaseSync;
	id: string;
}): AgentTurnRow | null {
	const row = database.prepare(`${SELECT_TURN} WHERE id = ?`).get(id) as
		| TurnRowShape
		| undefined;

	return row ? mapTurnRow(row) : null;
}

/** Returns all turns for a branch in ordinal order. */
export function listTurns({
	database,
	branchId,
}: {
	database: DatabaseSync;
	branchId: string;
}): readonly AgentTurnRow[] {
	const rows = database
		.prepare(`${SELECT_TURN} WHERE branch_id = ? ORDER BY ordinal ASC`)
		.all(branchId) as unknown as TurnRowShape[];

	return rows.map(mapTurnRow);
}

/** Patches one or more mutable turn fields. */
export function updateTurn({
	database,
	id,
	patch,
}: {
	database: DatabaseSync;
	id: string;
	patch: UpdateAgentTurnPatch;
}): AgentTurnRow | null {
	const fields: string[] = [];
	const values: Array<string | null> = [];

	if ('status' in patch && patch.status !== undefined) {
		fields.push('status = ?');
		values.push(patch.status);
	}
	if ('completedAt' in patch) {
		fields.push('completed_at = ?');
		values.push(patch.completedAt ?? null);
	}
	if ('turnMetadata' in patch && patch.turnMetadata !== undefined) {
		fields.push('turn_metadata_json = ?');
		values.push(serializeMetadata(patch.turnMetadata));
	}

	if (fields.length === 0) {
		return getTurnById({ database, id });
	}

	database
		.prepare(`UPDATE agent_turns SET ${fields.join(', ')} WHERE id = ?`)
		.run(...values, id);

	return getTurnById({ database, id });
}

/**
 * Maps a raw SQLite session row to its domain shape, parsing the metadata JSON.
 * @param row - Raw `agent_sessions` row
 * @returns The domain-shaped session record
 */
function mapSessionRow(row: SessionRowShape): AgentSessionRow {
	return {
		runtimeSessionId: row.runtime_session_id,
		closedAt: row.closed_at,
		createdAt: row.created_at,
		cwd: row.cwd,
		executableId: row.executable_id,
		executablePath: row.executable_path,
		id: row.id,
		label: row.label,
		lastError: row.last_error,
		metadata: parseMetadata(row.metadata_json),
		model: row.model,
		provider: normalizeAgentProviderId(row.provider),
		status: row.status,
		thinkingLevel: row.thinking_level,
		updatedAt: row.updated_at,
		workspaceId: row.workspace_id,
	};
}

/**
 * Maps a raw SQLite branch row to its domain shape, parsing the metadata JSON.
 * @param row - Raw `agent_session_branches` row
 * @returns The domain-shaped branch record
 */
function mapBranchRow(row: BranchRowShape): AgentSessionBranchRow {
	return {
		agentSessionId: row.agent_session_id,
		createdAt: row.created_at,
		forkedFromTurnId: row.forked_from_turn_id,
		id: row.id,
		kind: row.kind,
		label: row.label,
		metadata: parseMetadata(row.metadata_json),
		parentBranchId: row.parent_branch_id,
	};
}

/**
 * Maps a raw SQLite turn row to its domain shape, parsing the metadata JSON.
 * @param row - Raw `agent_turns` row
 * @returns The domain-shaped turn record
 */
function mapTurnRow(row: TurnRowShape): AgentTurnRow {
	return {
		branchId: row.branch_id,
		completedAt: row.completed_at,
		id: row.id,
		model: row.model,
		ordinal: row.ordinal,
		promptText: row.prompt_text,
		status: row.status,
		submittedAt: row.submitted_at,
		thinkingLevel: row.thinking_level,
		turnMetadata: parseMetadata(row.turn_metadata_json),
	};
}
