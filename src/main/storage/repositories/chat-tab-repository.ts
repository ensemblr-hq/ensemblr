import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type ChatTabKind = 'chat' | 'preview';

export interface ChatTabRow {
	closedAt: string | null;
	id: string;
	kind: ChatTabKind;
	metadata: Record<string, unknown>;
	openedAt: string;
	piSessionId: string | null;
	position: number;
	title: string;
	workspaceId: string;
}

export interface OpenChatTabInput {
	kind: ChatTabKind;
	metadata?: Record<string, unknown>;
	piSessionId?: string | null;
	title: string;
	workspaceId: string;
}

export interface PiRuntimeStateRow {
	activeTabId: string | null;
	lastActiveSessionId: string | null;
	updatedAt: string;
	workspaceId: string;
}

interface ChatTabRowShape {
	closed_at: string | null;
	id: string;
	kind: ChatTabKind;
	metadata_json: string;
	opened_at: string;
	pi_session_id: string | null;
	position: number;
	title: string;
	workspace_id: string;
}

interface RuntimeStateRowShape {
	active_tab_id: string | null;
	last_active_session_id: string | null;
	updated_at: string;
	workspace_id: string;
}

const SELECT_TAB = `SELECT id, workspace_id, pi_session_id, kind, title, position, opened_at, closed_at, metadata_json
FROM chat_tabs`;

const SELECT_RUNTIME = `SELECT workspace_id, active_tab_id, last_active_session_id, updated_at
FROM pi_runtime_state`;

/** Opens a new chat tab, appending it to the end of the open-tab ordering. */
export function openChatTab({
	database,
	input,
}: {
	database: DatabaseSync;
	input: OpenChatTabInput;
}): ChatTabRow {
	const id = randomUUID();
	const metadata = serializeMetadata(input.metadata);

	database.exec('BEGIN IMMEDIATE');
	try {
		const next = database
			.prepare(
				`SELECT COALESCE(MAX(position), -1) + 1 AS next FROM chat_tabs WHERE workspace_id = ? AND closed_at IS NULL`,
			)
			.get(input.workspaceId) as { next: number };

		database
			.prepare(
				`INSERT INTO chat_tabs (id, workspace_id, pi_session_id, kind, title, position, metadata_json)
					VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				id,
				input.workspaceId,
				input.piSessionId ?? null,
				input.kind,
				input.title,
				next.next,
				metadata,
			);

		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}

	const row = getChatTabById({ database, id });
	if (!row) {
		throw new Error('chat-tab-repository: tab insert did not round-trip');
	}
	return row;
}

/** Marks a chat tab as closed. Returns the updated row. */
export function closeChatTab({
	database,
	id,
}: {
	database: DatabaseSync;
	id: string;
}): ChatTabRow | null {
	database
		.prepare(
			`UPDATE chat_tabs SET closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND closed_at IS NULL`,
		)
		.run(id);

	return getChatTabById({ database, id });
}

/** Reopens a closed chat tab and moves it to the end of the open-tab ordering. */
export function restoreChatTab({
	database,
	id,
}: {
	database: DatabaseSync;
	id: string;
}): ChatTabRow | null {
	const existing = getChatTabById({ database, id });
	if (!existing) {
		return null;
	}
	if (existing.closedAt === null) {
		return existing;
	}

	database.exec('BEGIN IMMEDIATE');
	try {
		const next = database
			.prepare(
				`SELECT COALESCE(MAX(position), -1) + 1 AS next FROM chat_tabs WHERE workspace_id = ? AND closed_at IS NULL`,
			)
			.get(existing.workspaceId) as { next: number };

		database
			.prepare(
				`UPDATE chat_tabs SET closed_at = NULL, position = ? WHERE id = ?`,
			)
			.run(next.next, id);

		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}

	return getChatTabById({ database, id });
}

/** Renames the chat tab title. */
export function renameChatTab({
	database,
	id,
	title,
}: {
	database: DatabaseSync;
	id: string;
	title: string;
}): ChatTabRow | null {
	database
		.prepare(`UPDATE chat_tabs SET title = ? WHERE id = ?`)
		.run(title, id);
	return getChatTabById({ database, id });
}

/** Replaces the JSON metadata blob for a chat tab. */
export function setChatTabMetadata({
	database,
	id,
	metadata,
}: {
	database: DatabaseSync;
	id: string;
	metadata: Record<string, unknown>;
}): void {
	database
		.prepare(`UPDATE chat_tabs SET metadata_json = ? WHERE id = ?`)
		.run(JSON.stringify(metadata), id);
}

/** Permanently removes a chat tab row, used for empty tabs with no history. */
export function deleteChatTab({
	database,
	id,
}: {
	database: DatabaseSync;
	id: string;
}): void {
	database.prepare(`DELETE FROM chat_tabs WHERE id = ?`).run(id);
}

/** Returns a tab by id (open or closed), or `null` when no row matches. */
export function getChatTabById({
	database,
	id,
}: {
	database: DatabaseSync;
	id: string;
}): ChatTabRow | null {
	const row = database.prepare(`${SELECT_TAB} WHERE id = ?`).get(id) as
		| ChatTabRowShape
		| undefined;
	return row ? mapTabRow(row) : null;
}

/** Returns all open tabs for a workspace in position order. */
export function listOpenChatTabs({
	database,
	workspaceId,
}: {
	database: DatabaseSync;
	workspaceId: string;
}): readonly ChatTabRow[] {
	const rows = database
		.prepare(
			`${SELECT_TAB} WHERE workspace_id = ? AND closed_at IS NULL ORDER BY position ASC, opened_at ASC`,
		)
		.all(workspaceId) as unknown as ChatTabRowShape[];

	return rows.map(mapTabRow);
}

/** Alias for {@link listOpenChatTabs} matching the wire-contract naming. */
export function listOpenForWorkspace({
	database,
	workspaceId,
}: {
	database: DatabaseSync;
	workspaceId: string;
}): readonly ChatTabRow[] {
	return listOpenChatTabs({ database, workspaceId });
}

/**
 * Returns all closed tabs for a workspace, most-recently closed first. Used to
 * rehydrate the "previous chats" history surface in the renderer.
 */
export function listClosedForWorkspace({
	database,
	workspaceId,
}: {
	database: DatabaseSync;
	workspaceId: string;
}): readonly ChatTabRow[] {
	const rows = database
		.prepare(
			`${SELECT_TAB} WHERE workspace_id = ? AND closed_at IS NOT NULL ORDER BY closed_at DESC, opened_at DESC`,
		)
		.all(workspaceId) as unknown as ChatTabRowShape[];

	return rows.map(mapTabRow);
}

/** Marks a tab as closed. Alias for {@link closeChatTab}. */
export function markClosed({
	database,
	id,
}: {
	database: DatabaseSync;
	id: string;
}): ChatTabRow | null {
	return closeChatTab({ database, id });
}

/** Reopens a closed tab. Alias for {@link restoreChatTab}. */
export function restoreClosedChatTab({
	database,
	id,
}: {
	database: DatabaseSync;
	id: string;
}): ChatTabRow | null {
	return restoreChatTab({ database, id });
}

/**
 * Attaches an existing Pi session to a chat tab. Returns the updated row, or
 * `null` when no tab with `id` exists.
 */
export function bindPiSession({
	database,
	id,
	piSessionId,
}: {
	database: DatabaseSync;
	id: string;
	piSessionId: string;
}): ChatTabRow | null {
	database
		.prepare(`UPDATE chat_tabs SET pi_session_id = ? WHERE id = ?`)
		.run(piSessionId, id);
	return getChatTabById({ database, id });
}

/** Returns all open tabs bound to a given Pi session, in position order. */
export function listOpenChatTabsBySession({
	database,
	sessionId,
}: {
	database: DatabaseSync;
	sessionId: string;
}): readonly ChatTabRow[] {
	const rows = database
		.prepare(
			`${SELECT_TAB} WHERE pi_session_id = ? AND closed_at IS NULL ORDER BY position ASC, opened_at ASC`,
		)
		.all(sessionId) as unknown as ChatTabRowShape[];

	return rows.map(mapTabRow);
}

/** Reorders open tabs to match the supplied id sequence. */
export function reorderChatTabs({
	database,
	workspaceId,
	orderedIds,
}: {
	database: DatabaseSync;
	orderedIds: readonly string[];
	workspaceId: string;
}): readonly ChatTabRow[] {
	database.exec('BEGIN IMMEDIATE');
	try {
		const update = database.prepare(
			`UPDATE chat_tabs SET position = ? WHERE id = ? AND workspace_id = ?`,
		);
		orderedIds.forEach((id, index) => {
			update.run(index, id, workspaceId);
		});
		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}

	return listOpenChatTabs({ database, workspaceId });
}

/** Reads the runtime state row for a workspace, returning defaults when absent. */
export function getRuntimeState({
	database,
	workspaceId,
}: {
	database: DatabaseSync;
	workspaceId: string;
}): PiRuntimeStateRow {
	const row = database
		.prepare(`${SELECT_RUNTIME} WHERE workspace_id = ?`)
		.get(workspaceId) as RuntimeStateRowShape | undefined;

	if (!row) {
		return {
			activeTabId: null,
			lastActiveSessionId: null,
			updatedAt: '',
			workspaceId,
		};
	}

	return mapRuntimeRow(row);
}

/** Upserts the per-workspace runtime state row. */
export function setRuntimeState({
	database,
	workspaceId,
	activeTabId,
	lastActiveSessionId,
}: {
	activeTabId?: string | null;
	database: DatabaseSync;
	lastActiveSessionId?: string | null;
	workspaceId: string;
}): PiRuntimeStateRow {
	database
		.prepare(
			`INSERT INTO pi_runtime_state (workspace_id, active_tab_id, last_active_session_id)
			 VALUES (?, ?, ?)
			 ON CONFLICT(workspace_id) DO UPDATE SET
				active_tab_id = excluded.active_tab_id,
				last_active_session_id = excluded.last_active_session_id,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
		)
		.run(workspaceId, activeTabId ?? null, lastActiveSessionId ?? null);

	return getRuntimeState({ database, workspaceId });
}

function mapTabRow(row: ChatTabRowShape): ChatTabRow {
	return {
		closedAt: row.closed_at,
		id: row.id,
		kind: row.kind,
		metadata: parseMetadata(row.metadata_json),
		openedAt: row.opened_at,
		piSessionId: row.pi_session_id,
		position: row.position,
		title: row.title,
		workspaceId: row.workspace_id,
	};
}

function mapRuntimeRow(row: RuntimeStateRowShape): PiRuntimeStateRow {
	return {
		activeTabId: row.active_tab_id,
		lastActiveSessionId: row.last_active_session_id,
		updatedAt: row.updated_at,
		workspaceId: row.workspace_id,
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
