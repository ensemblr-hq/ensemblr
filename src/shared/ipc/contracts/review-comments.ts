/**
 * Wire contracts for Ensemblr-local review comments and todos (THE-152).
 * Rows live in SQLite (`comments` / `todos` tables, ADR 0008) and are always
 * labelled as local so they never read as GitHub review state.
 */

export type ReviewCommentStatus = 'archived' | 'open' | 'resolved';

export interface ReviewCommentWire {
	body: string;
	createdAt: string;
	filePath: string;
	id: string;
	lineNumber: number | null;
	status: ReviewCommentStatus;
	updatedAt: string;
	workspaceId: string;
}

export type ReviewTodoStatus = 'canceled' | 'done' | 'in_progress' | 'open';

export interface ReviewTodoWire {
	createdAt: string;
	id: string;
	position: number;
	status: ReviewTodoStatus;
	title: string;
	updatedAt: string;
	workspaceId: string;
}

export interface ListReviewCommentsRequest {
	workspaceId: string;
}

export interface ListReviewCommentsResult {
	comments: readonly ReviewCommentWire[];
}

/** Create (no `id`) or update (with `id`) a local review comment. */
export interface SaveReviewCommentRequest {
	body?: string;
	filePath?: string;
	id?: string;
	lineNumber?: number | null;
	status?: ReviewCommentStatus;
	workspaceId: string;
}

export interface SaveReviewCommentResult {
	comment: ReviewCommentWire;
}

export interface DeleteReviewCommentRequest {
	id: string;
}

export interface DeleteReviewCommentResult {
	ok: true;
}

export interface ListReviewTodosRequest {
	workspaceId: string;
}

export interface ListReviewTodosResult {
	todos: readonly ReviewTodoWire[];
}

/** Create (no `id`) or update (with `id`) a workspace review todo. */
export interface SaveReviewTodoRequest {
	id?: string;
	status?: ReviewTodoStatus;
	title?: string;
	workspaceId: string;
}

export interface SaveReviewTodoResult {
	todo: ReviewTodoWire;
}

export interface DeleteReviewTodoRequest {
	id: string;
}

export interface DeleteReviewTodoResult {
	ok: true;
}

/** Local review comments/todos IPC surface. */
export interface ReviewCommentsApi {
	deleteReviewComment: (
		request: DeleteReviewCommentRequest,
	) => Promise<DeleteReviewCommentResult>;
	deleteReviewTodo: (
		request: DeleteReviewTodoRequest,
	) => Promise<DeleteReviewTodoResult>;
	listReviewComments: (
		request: ListReviewCommentsRequest,
	) => Promise<ListReviewCommentsResult>;
	listReviewTodos: (
		request: ListReviewTodosRequest,
	) => Promise<ListReviewTodosResult>;
	saveReviewComment: (
		request: SaveReviewCommentRequest,
	) => Promise<SaveReviewCommentResult>;
	saveReviewTodo: (
		request: SaveReviewTodoRequest,
	) => Promise<SaveReviewTodoResult>;
}
