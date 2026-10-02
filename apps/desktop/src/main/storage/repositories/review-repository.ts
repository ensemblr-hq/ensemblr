import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
	ReviewCommentOrigin,
	ReviewCommentStatus,
	ReviewCommentWire,
	ReviewTodoStatus,
	ReviewTodoWire,
} from '../../../shared/ipc/contracts/review-comments';

/** Raw snake_case column shape of a `comments` row as read from SQLite. */
interface CommentRowShape {
	body: string;
	created_at: string;
	file_path: string;
	id: string;
	line_number: number | null;
	origin: string;
	status: string;
	updated_at: string;
	workspace_id: string;
}

/** Raw snake_case column shape of a `todos` row as read from SQLite. */
interface TodoRowShape {
	created_at: string;
	id: string;
	position: number;
	status: string;
	title: string;
	updated_at: string;
	workspace_id: string;
}

const COMMENT_COLUMNS = `id, workspace_id, file_path, line_number, body, origin, status, created_at, updated_at`;
const TODO_COLUMNS = `id, workspace_id, title, status, position, created_at, updated_at`;
const SELECT_COMMENT = `SELECT ${COMMENT_COLUMNS} FROM comments`;
const SELECT_TODO = `SELECT ${TODO_COLUMNS} FROM todos`;

/** Lists non-archived local review comments for a workspace, newest last. */
export function listReviewComments({
	database,
	workspaceId,
}: {
	database: DatabaseSync;
	workspaceId: string;
}): ReviewCommentWire[] {
	const rows = database
		.prepare(
			`${SELECT_COMMENT} WHERE workspace_id = ? AND status != 'archived' ORDER BY created_at ASC`,
		)
		.all(workspaceId) as unknown as CommentRowShape[];
	return rows.map(toCommentWire);
}

/** Inserts a new local review comment row. */
export function insertReviewComment({
	body,
	database,
	filePath,
	lineNumber,
	origin,
	workspaceId,
}: {
	body: string;
	database: DatabaseSync;
	filePath: string;
	lineNumber: number | null;
	origin: ReviewCommentOrigin;
	workspaceId: string;
}): ReviewCommentWire {
	const row = database
		.prepare(
			`INSERT INTO comments (id, workspace_id, file_path, line_number, body, origin) VALUES (?, ?, ?, ?, ?, ?) RETURNING ${COMMENT_COLUMNS}`,
		)
		.get(randomUUID(), workspaceId, filePath, lineNumber, body, origin) as
		| CommentRowShape
		| undefined;
	if (!row) {
		throw new Error('Failed to insert review comment.');
	}
	return toCommentWire(row);
}

/**
 * Updates body/status of an existing comment; returns the fresh row, or null
 * when no comment with that id belongs to the workspace.
 *
 * `workspaceId` is required rather than optional because comment ids travel:
 * `addDiffComments` returns them to an agent, and `readConversation` replays
 * another conversation's tool results across workspace boundaries by design. An
 * optional scope is one a caller forgets, and forgetting it here lets an agent
 * in one workspace rewrite a comment in another.
 */
export function updateReviewComment({
	body,
	database,
	id,
	status,
	workspaceId,
}: {
	body?: string;
	database: DatabaseSync;
	id: string;
	status?: ReviewCommentStatus;
	workspaceId: string;
}): ReviewCommentWire | null {
	const row = database
		.prepare(
			`UPDATE comments SET body = COALESCE(?, body), status = COALESCE(?, status), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND workspace_id = ? RETURNING ${COMMENT_COLUMNS}`,
		)
		.get(body ?? null, status ?? null, id, workspaceId) as
		| CommentRowShape
		| undefined;
	return row ? toCommentWire(row) : null;
}

/**
 * Deletes a local review comment belonging to the given workspace. Scoped for
 * the same reason as {@link updateReviewComment}.
 */
export function deleteReviewComment({
	database,
	id,
	workspaceId,
}: {
	database: DatabaseSync;
	id: string;
	workspaceId: string;
}): void {
	database
		.prepare(`DELETE FROM comments WHERE id = ? AND workspace_id = ?`)
		.run(id, workspaceId);
}

/** Lists workspace review todos ordered by position then creation. */
export function listReviewTodos({
	database,
	workspaceId,
}: {
	database: DatabaseSync;
	workspaceId: string;
}): ReviewTodoWire[] {
	const rows = database
		.prepare(
			`${SELECT_TODO} WHERE workspace_id = ? ORDER BY position ASC, created_at ASC`,
		)
		.all(workspaceId) as unknown as TodoRowShape[];
	return rows.map(toTodoWire);
}

/** Inserts a workspace review todo at the end of the list. */
export function insertReviewTodo({
	database,
	title,
	workspaceId,
}: {
	database: DatabaseSync;
	title: string;
	workspaceId: string;
}): ReviewTodoWire {
	const row = database
		.prepare(
			`INSERT INTO todos (id, workspace_id, title, position) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM todos WHERE workspace_id = ?)) RETURNING ${TODO_COLUMNS}`,
		)
		.get(randomUUID(), workspaceId, title, workspaceId) as
		| TodoRowShape
		| undefined;
	if (!row) {
		throw new Error('Failed to insert review todo.');
	}
	return toTodoWire(row);
}

/** Updates title/status of an existing todo; returns the fresh row. */
export function updateReviewTodo({
	database,
	id,
	status,
	title,
}: {
	database: DatabaseSync;
	id: string;
	status?: ReviewTodoStatus;
	title?: string;
}): ReviewTodoWire | null {
	const row = database
		.prepare(
			`UPDATE todos SET title = COALESCE(?, title), status = COALESCE(?, status), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? RETURNING ${TODO_COLUMNS}`,
		)
		.get(title ?? null, status ?? null, id) as TodoRowShape | undefined;
	return row ? toTodoWire(row) : null;
}

/** Deletes a workspace review todo. */
export function deleteReviewTodo({
	database,
	id,
}: {
	database: DatabaseSync;
	id: string;
}): void {
	database.prepare(`DELETE FROM todos WHERE id = ?`).run(id);
}

/**
 * Maps a raw SQLite comment row to its camelCase IPC wire shape.
 * @param row - Raw `comments` row
 * @returns The wire-shaped review comment
 */
function toCommentWire(row: CommentRowShape): ReviewCommentWire {
	return {
		body: row.body,
		createdAt: row.created_at,
		filePath: row.file_path,
		id: row.id,
		lineNumber: row.line_number,
		origin: row.origin as ReviewCommentOrigin,
		status: row.status as ReviewCommentStatus,
		updatedAt: row.updated_at,
		workspaceId: row.workspace_id,
	};
}

/**
 * Maps a raw SQLite todo row to its camelCase IPC wire shape.
 * @param row - Raw `todos` row
 * @returns The wire-shaped review todo
 */
function toTodoWire(row: TodoRowShape): ReviewTodoWire {
	return {
		createdAt: row.created_at,
		id: row.id,
		position: row.position,
		status: row.status as ReviewTodoStatus,
		title: row.title,
		updatedAt: row.updated_at,
		workspaceId: row.workspace_id,
	};
}
