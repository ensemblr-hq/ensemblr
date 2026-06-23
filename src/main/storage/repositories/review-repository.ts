import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
	ReviewCommentStatus,
	ReviewCommentWire,
	ReviewTodoStatus,
	ReviewTodoWire,
} from '../../../shared/ipc/contracts/review-comments';

interface CommentRowShape {
	body: string;
	created_at: string;
	file_path: string;
	id: string;
	line_number: number | null;
	status: string;
	updated_at: string;
	workspace_id: string;
}

interface TodoRowShape {
	created_at: string;
	id: string;
	position: number;
	status: string;
	title: string;
	updated_at: string;
	workspace_id: string;
}

const COMMENT_COLUMNS = `id, workspace_id, file_path, line_number, body, status, created_at, updated_at`;
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
	workspaceId,
}: {
	body: string;
	database: DatabaseSync;
	filePath: string;
	lineNumber: number | null;
	workspaceId: string;
}): ReviewCommentWire {
	const row = database
		.prepare(
			`INSERT INTO comments (id, workspace_id, file_path, line_number, body) VALUES (?, ?, ?, ?, ?) RETURNING ${COMMENT_COLUMNS}`,
		)
		.get(randomUUID(), workspaceId, filePath, lineNumber, body) as
		| CommentRowShape
		| undefined;
	if (!row) {
		throw new Error('Failed to insert review comment.');
	}
	return toCommentWire(row);
}

/** Updates body/status of an existing comment; returns the fresh row. */
export function updateReviewComment({
	body,
	database,
	id,
	status,
}: {
	body?: string;
	database: DatabaseSync;
	id: string;
	status?: ReviewCommentStatus;
}): ReviewCommentWire | null {
	const row = database
		.prepare(
			`UPDATE comments SET body = COALESCE(?, body), status = COALESCE(?, status), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? RETURNING ${COMMENT_COLUMNS}`,
		)
		.get(body ?? null, status ?? null, id) as CommentRowShape | undefined;
	return row ? toCommentWire(row) : null;
}

/** Deletes a local review comment. */
export function deleteReviewComment({
	database,
	id,
}: {
	database: DatabaseSync;
	id: string;
}): void {
	database.prepare(`DELETE FROM comments WHERE id = ?`).run(id);
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

function toCommentWire(row: CommentRowShape): ReviewCommentWire {
	return {
		body: row.body,
		createdAt: row.created_at,
		filePath: row.file_path,
		id: row.id,
		lineNumber: row.line_number,
		status: row.status as ReviewCommentStatus,
		updatedAt: row.updated_at,
		workspaceId: row.workspace_id,
	};
}

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
