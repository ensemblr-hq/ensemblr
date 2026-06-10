import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type PiSessionStatus =
	| 'idle'
	| 'starting'
	| 'streaming'
	| 'closed'
	| 'errored';

export type PiSessionBranchKind = 'main' | 'retry' | 'fork';

export type PiTurnStatus =
	| 'submitted'
	| 'streaming'
	| 'completed'
	| 'aborted'
	| 'errored';

export interface PiSessionRow {
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
	piSessionId: string | null;
	status: PiSessionStatus;
	thinkingLevel: string | null;
	updatedAt: string;
	workspaceId: string;
}

export interface PiSessionBranchRow {
	createdAt: string;
	forkedFromTurnId: string | null;
	id: string;
	kind: PiSessionBranchKind;
	label: string | null;
	metadata: Record<string, unknown>;
	parentBranchId: string | null;
	piSessionId: string;
}

export interface PiTurnRow {
	branchId: string;
	completedAt: string | null;
	id: string;
	model: string | null;
	ordinal: number;
	promptText: string;
	status: PiTurnStatus;
	submittedAt: string;
	thinkingLevel: string | null;
	turnMetadata: Record<string, unknown>;
}

export interface CreatePiSessionInput {
	cwd: string;
	executableId?: string | null;
	executablePath?: string | null;
	label?: string | null;
	metadata?: Record<string, unknown>;
	model?: string | null;
	piSessionId?: string | null;
	thinkingLevel?: string | null;
	workspaceId: string;
}

export interface CreatePiSessionResult {
	mainBranch: PiSessionBranchRow;
	session: PiSessionRow;
}

export interface UpdatePiSessionPatch {
	closedAt?: string | null;
	lastError?: string | null;
	model?: string | null;
	piSessionId?: string | null;
	status?: PiSessionStatus;
	thinkingLevel?: string | null;
}

export interface CreatePiTurnInput {
	branchId: string;
	model?: string | null;
	promptText: string;
	thinkingLevel?: string | null;
	turnMetadata?: Record<string, unknown>;
}

export interface UpdatePiTurnPatch {
	completedAt?: string | null;
	status?: PiTurnStatus;
	turnMetadata?: Record<string, unknown>;
}

interface SessionRowShape {
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
	pi_session_id: string | null;
	status: PiSessionStatus;
	thinking_level: string | null;
	updated_at: string;
	workspace_id: string;
}

interface BranchRowShape {
	created_at: string;
	forked_from_turn_id: string | null;
	id: string;
	kind: PiSessionBranchKind;
	label: string | null;
	metadata_json: string;
	parent_branch_id: string | null;
	pi_session_id: string;
}

interface TurnRowShape {
	branch_id: string;
	completed_at: string | null;
	id: string;
	model: string | null;
	ordinal: number;
	prompt_text: string;
	status: PiTurnStatus;
	submitted_at: string;
	thinking_level: string | null;
	turn_metadata_json: string;
}

const SELECT_SESSION = `SELECT id, workspace_id, pi_session_id, executable_id, executable_path,
  model, thinking_level, status, last_error, cwd, label, created_at, updated_at, closed_at, metadata_json
FROM pi_sessions`;

const SELECT_BRANCH = `SELECT id, pi_session_id, parent_branch_id, forked_from_turn_id, kind, label, created_at, metadata_json
FROM pi_session_branches`;

const SELECT_TURN = `SELECT id, branch_id, ordinal, status, prompt_text, model, thinking_level, submitted_at, completed_at, turn_metadata_json
FROM pi_turns`;

/**
 * Creates a Pi session row plus an initial `main` branch in a single
 * transaction so callers never observe a session without a branch.
 */
export function createPiSession({
	database,
	input,
}: {
	database: DatabaseSync;
	input: CreatePiSessionInput;
}): CreatePiSessionResult {
	const sessionId = randomUUID();
	const branchId = randomUUID();
	const metadata = serializeMetadata(input.metadata);

	database.exec('BEGIN IMMEDIATE');
	try {
		database
			.prepare(
				`INSERT INTO pi_sessions (
					id, workspace_id, pi_session_id, executable_id, executable_path,
					model, thinking_level, status, cwd, label, metadata_json
				) VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?, ?)`,
			)
			.run(
				sessionId,
				input.workspaceId,
				input.piSessionId ?? null,
				input.executableId ?? null,
				input.executablePath ?? null,
				input.model ?? null,
				input.thinkingLevel ?? null,
				input.cwd,
				input.label ?? null,
				metadata,
			);

		database
			.prepare(
				`INSERT INTO pi_session_branches (id, pi_session_id, kind)
				 VALUES (?, ?, 'main')`,
			)
			.run(branchId, sessionId);

		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}

	const session = getPiSessionById({ database, id: sessionId });
	const mainBranch = getPiSessionBranchById({ database, id: branchId });

	if (!session || !mainBranch) {
		throw new Error('pi-session-repository: failed to read back inserted rows');
	}

	return { mainBranch, session };
}

/** Returns the session row, or `null` when no row matches. */
export function getPiSessionById({
	database,
	id,
}: {
	database: DatabaseSync;
	id: string;
}): PiSessionRow | null {
	const row = database.prepare(`${SELECT_SESSION} WHERE id = ?`).get(id) as
		| SessionRowShape
		| undefined;

	return row ? mapSessionRow(row) : null;
}

/** Returns the open sessions for the workspace, most recently updated first. */
export function listPiSessionsByWorkspace({
	database,
	workspaceId,
}: {
	database: DatabaseSync;
	workspaceId: string;
}): readonly PiSessionRow[] {
	const rows = database
		.prepare(
			`${SELECT_SESSION} WHERE workspace_id = ? ORDER BY updated_at DESC`,
		)
		.all(workspaceId) as unknown as SessionRowShape[];

	return rows.map(mapSessionRow);
}

/** Patches one or more mutable session fields and bumps `updated_at`. */
export function updatePiSession({
	database,
	id,
	patch,
}: {
	database: DatabaseSync;
	id: string;
	patch: UpdatePiSessionPatch;
}): PiSessionRow | null {
	const fields: string[] = [];
	const values: Array<string | null> = [];

	if ('status' in patch && patch.status !== undefined) {
		fields.push('status = ?');
		values.push(patch.status);
	}
	if ('piSessionId' in patch) {
		fields.push('pi_session_id = ?');
		values.push(patch.piSessionId ?? null);
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
		return getPiSessionById({ database, id });
	}

	fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");

	database
		.prepare(`UPDATE pi_sessions SET ${fields.join(', ')} WHERE id = ?`)
		.run(...values, id);

	return getPiSessionById({ database, id });
}

/** Returns the branch row, or `null` when no row matches. */
export function getPiSessionBranchById({
	database,
	id,
}: {
	database: DatabaseSync;
	id: string;
}): PiSessionBranchRow | null {
	const row = database.prepare(`${SELECT_BRANCH} WHERE id = ?`).get(id) as
		| BranchRowShape
		| undefined;

	return row ? mapBranchRow(row) : null;
}

/** Returns all branches for a session in creation order. */
export function listPiSessionBranches({
	database,
	piSessionId,
}: {
	database: DatabaseSync;
	piSessionId: string;
}): readonly PiSessionBranchRow[] {
	const rows = database
		.prepare(`${SELECT_BRANCH} WHERE pi_session_id = ? ORDER BY created_at ASC`)
		.all(piSessionId) as unknown as BranchRowShape[];

	return rows.map(mapBranchRow);
}

/**
 * Returns the canonical `main` branch for a session, falling back to the
 * first branch in creation order when no explicit `main` exists. Returns
 * `null` when the session has no branches at all.
 */
export function getMainBranchForSession({
	database,
	piSessionId,
}: {
	database: DatabaseSync;
	piSessionId: string;
}): PiSessionBranchRow | null {
	const branches = listPiSessionBranches({ database, piSessionId });
	return (
		branches.find((branch) => branch.kind === 'main') ?? branches[0] ?? null
	);
}

/** Creates a retry or fork branch from a parent. */
export function createBranch({
	database,
	forkedFromTurnId = null,
	kind,
	label = null,
	metadata,
	parentBranchId,
	piSessionId,
}: {
	database: DatabaseSync;
	forkedFromTurnId?: string | null;
	kind: PiSessionBranchKind;
	label?: string | null;
	metadata?: Record<string, unknown>;
	parentBranchId: string;
	piSessionId: string;
}): PiSessionBranchRow {
	const id = randomUUID();
	database
		.prepare(
			`INSERT INTO pi_session_branches
				(id, pi_session_id, parent_branch_id, forked_from_turn_id, kind, label, metadata_json)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			id,
			piSessionId,
			parentBranchId,
			forkedFromTurnId,
			kind,
			label,
			serializeMetadata(metadata),
		);

	const row = getPiSessionBranchById({ database, id });
	if (!row) {
		throw new Error('pi-session-repository: branch insert did not round-trip');
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
	input: CreatePiTurnInput;
}): PiTurnRow {
	const id = randomUUID();
	const metadata = serializeMetadata(input.turnMetadata);

	database.exec('BEGIN IMMEDIATE');
	try {
		const next = database
			.prepare(
				`SELECT COALESCE(MAX(ordinal), -1) + 1 AS next FROM pi_turns WHERE branch_id = ?`,
			)
			.get(input.branchId) as { next: number };

		database
			.prepare(
				`INSERT INTO pi_turns
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
		throw new Error('pi-session-repository: turn insert did not round-trip');
	}
	return row;
}

/** Returns the turn row, or `null` when no row matches. */
export function getTurnById({
	database,
	id,
}: {
	database: DatabaseSync;
	id: string;
}): PiTurnRow | null {
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
}): readonly PiTurnRow[] {
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
	patch: UpdatePiTurnPatch;
}): PiTurnRow | null {
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
		.prepare(`UPDATE pi_turns SET ${fields.join(', ')} WHERE id = ?`)
		.run(...values, id);

	return getTurnById({ database, id });
}

function mapSessionRow(row: SessionRowShape): PiSessionRow {
	return {
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
		piSessionId: row.pi_session_id,
		status: row.status,
		thinkingLevel: row.thinking_level,
		updatedAt: row.updated_at,
		workspaceId: row.workspace_id,
	};
}

function mapBranchRow(row: BranchRowShape): PiSessionBranchRow {
	return {
		createdAt: row.created_at,
		forkedFromTurnId: row.forked_from_turn_id,
		id: row.id,
		kind: row.kind,
		label: row.label,
		metadata: parseMetadata(row.metadata_json),
		parentBranchId: row.parent_branch_id,
		piSessionId: row.pi_session_id,
	};
}

function mapTurnRow(row: TurnRowShape): PiTurnRow {
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

function serializeMetadata(metadata?: Record<string, unknown>): string {
	if (!metadata) {
		return '{}';
	}
	try {
		return JSON.stringify(metadata);
	} catch {
		return '{}';
	}
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
