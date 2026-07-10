/**
 * Wire contracts for Ensemblr-local review comments and todos (THE-152).
 * Rows live in SQLite (`comments` / `todos` tables, ADR 0008) and are always
 * labelled as local so they never read as GitHub review state.
 */

export type ReviewCommentStatus = 'archived' | 'open' | 'resolved';

/** Wire shape of a single Ensemblr-local review comment. */
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

/** Lifecycle status of a workspace review todo. */
export type ReviewTodoStatus = 'canceled' | 'done' | 'in_progress' | 'open';

/** Wire shape of a single workspace review todo. */
export interface ReviewTodoWire {
	createdAt: string;
	id: string;
	position: number;
	status: ReviewTodoStatus;
	title: string;
	updatedAt: string;
	workspaceId: string;
}

/** Request to list local review comments for a workspace. */
export interface ListReviewCommentsRequest {
	workspaceId: string;
}

/** Result of listing local review comments for a workspace. */
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

/** Result of creating or updating a local review comment. */
export interface SaveReviewCommentResult {
	comment: ReviewCommentWire;
}

/** Request to delete a local review comment by id. */
export interface DeleteReviewCommentRequest {
	id: string;
}

/** Result of deleting a local review comment. */
export interface DeleteReviewCommentResult {
	ok: true;
}

/** Request to list review todos for a workspace. */
export interface ListReviewTodosRequest {
	workspaceId: string;
}

/** Result of listing review todos for a workspace. */
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

/** Result of creating or updating a workspace review todo. */
export interface SaveReviewTodoResult {
	todo: ReviewTodoWire;
}

/** Request to delete a review todo by id. */
export interface DeleteReviewTodoRequest {
	id: string;
}

/** Result of deleting a review todo. */
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
