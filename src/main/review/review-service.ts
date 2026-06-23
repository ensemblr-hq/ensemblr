/**
 * Business logic for Ensemble-local review comments and todos (THE-152).
 * Owns upsert routing and cross-field validation so the IPC handler stays a
 * thin parse-then-delegate wrapper.
 */
import type {
	DeleteReviewCommentRequest,
	DeleteReviewCommentResult,
	DeleteReviewTodoRequest,
	DeleteReviewTodoResult,
	ListReviewCommentsRequest,
	ListReviewCommentsResult,
	ListReviewTodosRequest,
	ListReviewTodosResult,
	SaveReviewCommentRequest,
	SaveReviewCommentResult,
	SaveReviewTodoRequest,
	SaveReviewTodoResult,
} from '../../shared/ipc/contracts/review-comments';
import {
	type EnsembleDatabaseService,
	requireDatabase,
} from '../storage/database.ts';
import {
	deleteReviewComment,
	deleteReviewTodo,
	insertReviewComment,
	insertReviewTodo,
	listReviewComments,
	listReviewTodos,
	updateReviewComment,
	updateReviewTodo,
} from '../storage/repositories/review-repository.ts';

export interface ReviewService {
	deleteComment: (
		request: DeleteReviewCommentRequest,
	) => DeleteReviewCommentResult;
	deleteTodo: (request: DeleteReviewTodoRequest) => DeleteReviewTodoResult;
	listComments: (
		request: ListReviewCommentsRequest,
	) => ListReviewCommentsResult;
	listTodos: (request: ListReviewTodosRequest) => ListReviewTodosResult;
	saveComment: (request: SaveReviewCommentRequest) => SaveReviewCommentResult;
	saveTodo: (request: SaveReviewTodoRequest) => SaveReviewTodoResult;
}

export interface ReviewServiceOptions {
	databaseService: EnsembleDatabaseService;
}

export function createReviewService({
	databaseService,
}: ReviewServiceOptions): ReviewService {
	const requireReviewDatabase = () =>
		requireDatabase(
			databaseService.getConnection()?.database,
			() => new Error('Database is not open; cannot access review items.'),
		);

	return {
		deleteComment(request) {
			deleteReviewComment({
				database: requireReviewDatabase(),
				id: request.id,
			});
			return { ok: true };
		},
		deleteTodo(request) {
			deleteReviewTodo({
				database: requireReviewDatabase(),
				id: request.id,
			});
			return { ok: true };
		},
		listComments(request) {
			return {
				comments: listReviewComments({
					database: requireReviewDatabase(),
					workspaceId: request.workspaceId,
				}),
			};
		},
		listTodos(request) {
			return {
				todos: listReviewTodos({
					database: requireReviewDatabase(),
					workspaceId: request.workspaceId,
				}),
			};
		},
		saveComment(request) {
			const database = requireReviewDatabase();
			if (request.id) {
				const updated = updateReviewComment({
					body: request.body,
					database,
					id: request.id,
					status: request.status,
				});
				if (!updated) {
					throw new Error('Review comment not found.');
				}
				return { comment: updated };
			}
			if (!request.filePath || !request.body?.trim()) {
				throw new Error('New review comments need a file path and body.');
			}
			return {
				comment: insertReviewComment({
					body: request.body,
					database,
					filePath: request.filePath,
					lineNumber: request.lineNumber ?? null,
					workspaceId: request.workspaceId,
				}),
			};
		},
		saveTodo(request) {
			const database = requireReviewDatabase();
			if (request.id) {
				const updated = updateReviewTodo({
					database,
					id: request.id,
					status: request.status,
					title: request.title,
				});
				if (!updated) {
					throw new Error('Review todo not found.');
				}
				return { todo: updated };
			}
			if (!request.title?.trim()) {
				throw new Error('New review todos need a title.');
			}
			return {
				todo: insertReviewTodo({
					database,
					title: request.title.trim(),
					workspaceId: request.workspaceId,
				}),
			};
		},
	};
}
