import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import type {
	DeleteReviewCommentResult,
	DeleteReviewTodoResult,
	ListReviewCommentsResult,
	ListReviewTodosResult,
	SaveReviewCommentResult,
	SaveReviewTodoResult,
} from '../../../shared/ipc/contracts/review-comments';
import type { ReviewService } from '../../review';
import {
	reviewDeleteRequestSchema,
	reviewListRequestSchema,
	saveReviewCommentRequestSchema,
	saveReviewTodoRequestSchema,
} from '../request-schemas.ts';

/** Dependencies for registering the review-comments and todos IPC handlers. */
export interface ReviewHandlersOptions {
	reviewService: ReviewService;
}

/** Registers IPC handlers for Ensemblr-local review comments and todos. */
export function registerReviewHandlers({
	reviewService,
}: ReviewHandlersOptions): void {
	ipcMain.handle(
		IPC_CHANNELS.listReviewComments,
		async (_event, raw: unknown): Promise<ListReviewCommentsResult> =>
			reviewService.listComments(reviewListRequestSchema.parse(raw)),
	);

	ipcMain.handle(
		IPC_CHANNELS.saveReviewComment,
		async (_event, raw: unknown): Promise<SaveReviewCommentResult> =>
			reviewService.saveComment(saveReviewCommentRequestSchema.parse(raw)),
	);

	ipcMain.handle(
		IPC_CHANNELS.deleteReviewComment,
		async (_event, raw: unknown): Promise<DeleteReviewCommentResult> =>
			reviewService.deleteComment(reviewDeleteRequestSchema.parse(raw)),
	);

	ipcMain.handle(
		IPC_CHANNELS.listReviewTodos,
		async (_event, raw: unknown): Promise<ListReviewTodosResult> =>
			reviewService.listTodos(reviewListRequestSchema.parse(raw)),
	);

	ipcMain.handle(
		IPC_CHANNELS.saveReviewTodo,
		async (_event, raw: unknown): Promise<SaveReviewTodoResult> =>
			reviewService.saveTodo(saveReviewTodoRequestSchema.parse(raw)),
	);

	ipcMain.handle(
		IPC_CHANNELS.deleteReviewTodo,
		async (_event, raw: unknown): Promise<DeleteReviewTodoResult> =>
			reviewService.deleteTodo(reviewDeleteRequestSchema.parse(raw)),
	);
}
