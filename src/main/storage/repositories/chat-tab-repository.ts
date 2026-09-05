import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { parseMetadata, serializeMetadata } from './metadata-json.ts';

/** Kind of content a chat tab hosts: a chat, diagram, diff, document, file, or preview. */
export type ChatTabKind =
	| 'chat'
	| 'diagram'
	| 'diff'
	| 'document'
	| 'file'
	| 'preview'
	| 'terminal';

/** Domain shape of a chat tab row returned by the repository. */
export interface ChatTabRow {
	agentSessionId: string | null;
	closedAt: string | null;
	/**
	 * Untruncated title, for tooltips and search. Equals `title` whenever the
	 * producer had nothing longer, and for rows predating the column.
	 */
	fullTitle: string;
	id: string;
	kind: ChatTabKind;
	metadata: Record<string, unknown>;
	openedAt: string;
	position: number;
	title: string;
	workspaceId: string;
}

/** Input for opening a new chat tab in a workspace. */
export interface OpenChatTabInput {
	agentSessionId?: string | null;
	/** Untruncated title; defaults to `title` when the caller has nothing longer. */
	fullTitle?: string;
	/**
	 * Open tab the new tab is placed directly to the right of. Appends after the
	 * last open tab when absent, or when the id is not an open tab of this
	 * workspace.
	 */
	insertAfterChatTabId?: string | null;
	kind: ChatTabKind;
	metadata?: Record<string, unknown>;
	title: string;
	workspaceId: string;
}

/** Per-workspace runtime state tracking the active tab and last active agent session. */
export interface AgentRuntimeStateRow {
	activeTabId: string | null;
	lastActiveSessionId: string | null;
	updatedAt: string;
	workspaceId: string;
}

/** Raw `chat_tabs` row shape with snake_case columns as stored in SQLite. */
interface ChatTabRowShape {
	agent_session_id: string | null;
	closed_at: string | null;
	full_title: string;
	id: string;
	kind: ChatTabKind;
	metadata_json: string;
	opened_at: string;
	position: number;
	title: string;
	workspace_id: string;
}

/** Raw `agent_runtime_state` row shape with snake_case columns as stored in SQLite. */
interface RuntimeStateRowShape {
	active_tab_id: string | null;
	last_active_session_id: string | null;
	updated_at: string;
	workspace_id: string;
}

const SELECT_TAB = `SELECT id, workspace_id, agent_session_id, kind, title, full_title, position, opened_at, closed_at, metadata_json
FROM chat_tabs`;

const SELECT_RUNTIME = `SELECT workspace_id, active_tab_id, last_active_session_id, updated_at
FROM agent_runtime_state`;

/**
 * Opens a new chat tab, placing it directly right of `insertAfterChatTabId` and
 * appending it to the end of the open-tab ordering when no such open tab exists.
 */
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
		const position = resolveOpenPosition({
			database,
			insertAfterChatTabId: input.insertAfterChatTabId ?? null,
			workspaceId: input.workspaceId,
		});
		shiftOpenPositionsFrom({
			database,
			position,
			workspaceId: input.workspaceId,
		});

		database
			.prepare(
				`INSERT INTO chat_tabs (id, workspace_id, agent_session_id, kind, title, full_title, position, metadata_json)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				id,
				input.workspaceId,
				input.agentSessionId ?? null,
				input.kind,
				input.title,
				input.fullTitle ?? input.title,
				position,
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

/**
 * Reopens a closed chat tab and moves it to the end of the open-tab ordering.
 * An archived tab keeps its session id so it can resume, but that session may
 * have been moved onto another tab meanwhile — the restore then comes back
 * detached rather than reintroducing a second surface for one conversation.
 */
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
		const position = resolveOpenPosition({
			database,
			insertAfterChatTabId: null,
			workspaceId: existing.workspaceId,
		});

		database
			.prepare(
				`UPDATE chat_tabs SET closed_at = NULL, position = ? WHERE id = ?`,
			)
			.run(position, id);
		database
			.prepare(
				`UPDATE chat_tabs SET agent_session_id = NULL
				 WHERE id = ?
				   AND agent_session_id IS NOT NULL
				   AND EXISTS (
				     SELECT 1 FROM chat_tabs AS holder
				     WHERE holder.agent_session_id = chat_tabs.agent_session_id
				       AND holder.id <> chat_tabs.id
				       AND holder.closed_at IS NULL
				   )`,
			)
			.run(id);

		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}

	return getChatTabById({ database, id });
}

/**
 * Renames the chat tab, storing the display title and its untruncated form.
 * `fullTitle` falls back to `title` so callers without a longer variant keep the
 * two columns consistent rather than leaving a stale full title behind.
 */
export function renameChatTab({
	database,
	fullTitle,
	id,
	title,
}: {
	database: DatabaseSync;
	fullTitle?: string;
	id: string;
	title: string;
}): ChatTabRow | null {
	database
		.prepare(`UPDATE chat_tabs SET title = ?, full_title = ? WHERE id = ?`)
		.run(title, fullTitle ?? title, id);
	return getChatTabById({ database, id });
}

/**
 * Points an existing open tab at a new subject, replacing its kind, title, and
 * metadata while keeping its id and strip position. Backs the preview slot: the
 * tab the user is looking at swaps content in place instead of being closed and
 * reopened elsewhere in the strip. `full_title` tracks `title`, matching how
 * auxiliary tabs are opened; {@link renameChatTab} is what records a longer form.
 */
export function retargetChatTab({
	database,
	id,
	kind,
	metadata,
	title,
}: {
	database: DatabaseSync;
	id: string;
	kind: ChatTabKind;
	metadata?: Record<string, unknown>;
	title: string;
}): ChatTabRow | null {
	database
		.prepare(
			`UPDATE chat_tabs SET kind = ?, title = ?, full_title = ?, metadata_json = ? WHERE id = ?`,
		)
		.run(kind, title, title, serializeMetadata(metadata), id);
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

/**
 * Returns the tab bound to an agent session (open or closed), or `null` when
 * none is. Lets a caller holding only a session id reach its tab without
 * scanning the workspace's tab list.
 */
export function getChatTabByAgentSessionId({
	agentSessionId,
	database,
}: {
	agentSessionId: string;
	database: DatabaseSync;
}): ChatTabRow | null {
	const row = database
		.prepare(
			`${SELECT_TAB} WHERE agent_session_id = ?
			 ORDER BY closed_at IS NULL DESC, opened_at DESC LIMIT 1`,
		)
		.get(agentSessionId) as ChatTabRowShape | undefined;
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

/**
 * Returns every workspace's open tabs, plus the most recently closed tabs across
 * all of them under a cap.
 *
 * The two halves are ordered differently on purpose: open tabs read as each
 * workspace's own strip, so they keep position order, while closed tabs have no
 * strip left to belong to and are only ever wanted newest-first. The cap applies
 * to the closed half alone — open tabs are bounded by what the user has on
 * screen, where closed ones accumulate for the life of a project.
 * @param database - The open SQLite connection.
 * @param closedLimit - How many recently-closed tabs to return.
 * @returns The open and closed tabs across every workspace.
 */
export function listChatTabsAcrossWorkspaces({
	closedLimit,
	database,
}: {
	closedLimit: number;
	database: DatabaseSync;
}): { closed: readonly ChatTabRow[]; open: readonly ChatTabRow[] } {
	const open = database
		.prepare(
			`${SELECT_TAB} WHERE closed_at IS NULL ORDER BY workspace_id ASC, position ASC, opened_at ASC`,
		)
		.all() as unknown as ChatTabRowShape[];
	const closed = database
		.prepare(
			`${SELECT_TAB} WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT ?`,
		)
		.all(closedLimit) as unknown as ChatTabRowShape[];

	return { closed: closed.map(mapTabRow), open: open.map(mapTabRow) };
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
 * Moves an existing agent session onto a chat tab, detaching whichever *open*
 * tab held it before. A session backs exactly one conversation surface, so
 * leaving the old pointer in place would render the same transcript in two tabs
 * and let both composers steer one runtime. An archived tab is not a surface and
 * keeps its pointer, so history stays intact; {@link restoreChatTab} applies the
 * same rule again if that tab ever reopens.
 * @param agentSessionId - Session to attach
 * @param database - Open database handle
 * @param id - Tab that should own the session
 * @returns The updated row, or `null` when no tab with `id` exists
 */
export function bindAgentSession({
	agentSessionId,
	database,
	id,
}: {
	agentSessionId: string;
	database: DatabaseSync;
	id: string;
}): ChatTabRow | null {
	database.exec('BEGIN IMMEDIATE');
	try {
		database
			.prepare(
				`UPDATE chat_tabs SET agent_session_id = NULL
				 WHERE agent_session_id = ? AND id <> ? AND closed_at IS NULL`,
			)
			.run(agentSessionId, id);
		database
			.prepare(`UPDATE chat_tabs SET agent_session_id = ? WHERE id = ?`)
			.run(agentSessionId, id);
		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
	return getChatTabById({ database, id });
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
}): AgentRuntimeStateRow {
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
}): AgentRuntimeStateRow {
	database
		.prepare(
			`INSERT INTO agent_runtime_state (workspace_id, active_tab_id, last_active_session_id)
			 VALUES (?, ?, ?)
			 ON CONFLICT(workspace_id) DO UPDATE SET
				active_tab_id = excluded.active_tab_id,
				last_active_session_id = excluded.last_active_session_id,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
		)
		.run(workspaceId, activeTabId ?? null, lastActiveSessionId ?? null);

	return getRuntimeState({ database, workspaceId });
}

/**
 * Resolves the strip position a tab entering the open set takes. An anchor that
 * is itself an open tab of the workspace puts the new tab immediately to its
 * right; anything else (no anchor, a closed tab, another workspace's tab) lands
 * after the last open tab.
 * @param options - Open database handle, the anchor tab id, and the workspace
 * @returns The position the entering tab should occupy
 */
function resolveOpenPosition({
	database,
	insertAfterChatTabId,
	workspaceId,
}: {
	database: DatabaseSync;
	insertAfterChatTabId: string | null;
	workspaceId: string;
}): number {
	const anchor = insertAfterChatTabId
		? (database
				.prepare(
					`SELECT position FROM chat_tabs WHERE id = ? AND workspace_id = ? AND closed_at IS NULL`,
				)
				.get(insertAfterChatTabId, workspaceId) as
				| { position: number }
				| undefined)
		: undefined;
	if (anchor) {
		return anchor.position + 1;
	}

	const last = database
		.prepare(
			`SELECT COALESCE(MAX(position), -1) AS last FROM chat_tabs WHERE workspace_id = ? AND closed_at IS NULL`,
		)
		.get(workspaceId) as { last: number };
	return last.last + 1;
}

/**
 * Frees a position by pushing every open tab at or after it one slot right, so
 * an insert in the middle of the strip cannot collide with its neighbours.
 * @param options - Open database handle, the position to free, and the workspace
 */
function shiftOpenPositionsFrom({
	database,
	position,
	workspaceId,
}: {
	database: DatabaseSync;
	position: number;
	workspaceId: string;
}): void {
	database
		.prepare(
			`UPDATE chat_tabs SET position = position + 1 WHERE workspace_id = ? AND closed_at IS NULL AND position >= ?`,
		)
		.run(workspaceId, position);
}

/**
 * Map a raw `chat_tabs` row to the domain {@link ChatTabRow}, parsing its metadata JSON.
 * @param row - Raw SQLite row
 * @returns The domain chat tab
 */
function mapTabRow(row: ChatTabRowShape): ChatTabRow {
	return {
		agentSessionId: row.agent_session_id,
		closedAt: row.closed_at,
		fullTitle: row.full_title || row.title,
		id: row.id,
		kind: row.kind,
		metadata: parseMetadata(row.metadata_json),
		openedAt: row.opened_at,
		position: row.position,
		title: row.title,
		workspaceId: row.workspace_id,
	};
}

/**
 * Map a raw `agent_runtime_state` row to the domain {@link AgentRuntimeStateRow}.
 * @param row - Raw SQLite row
 * @returns The domain runtime state
 */
function mapRuntimeRow(row: RuntimeStateRowShape): AgentRuntimeStateRow {
	return {
		activeTabId: row.active_tab_id,
		lastActiveSessionId: row.last_active_session_id,
		updatedAt: row.updated_at,
		workspaceId: row.workspace_id,
	};
}
