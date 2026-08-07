import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
	deleteReviewComment,
	ensemblrQueryKeys,
	saveReviewComment,
} from '@/renderer/api/ensemblr-queries';

const LOCAL_ID_PREFIX = 'local:';

/**
 * Strip the `local:` prefix from a diff comment id, returning the underlying
 * local review-comment id, or null for non-local (read-only GitHub) comments.
 * @param id - The diff comment id
 * @returns The local review-comment id, or null
 */
function localCommentId(id: string): string | null {
	return id.startsWith(LOCAL_ID_PREFIX)
		? id.slice(LOCAL_ID_PREFIX.length)
		: null;
}

/**
 * Show an error toast when a local review-comment mutation fails.
 * @param error - The thrown error, if any
 */
function notifyCommentFailed(error: unknown): void {
	toast.error('Comment update failed', {
		description: error instanceof Error ? error.message : undefined,
	});
}

/**
 * Wires the add, resolve, and delete mutations for one file's local review
 * comments, refreshing the workspace's comment list after each and surfacing
 * failures as a toast. Resolve and delete take the composite diff-comment id and
 * ignore read-only GitHub threads, which carry no local comment behind them.
 * @param filePath - Workspace-relative path new comments attach to
 * @param workspaceId - Workspace owning the review comments
 * @returns Handlers matching the diff viewer's comment callbacks
 */
export function useDiffCommentMutations({
	filePath,
	workspaceId,
}: {
	filePath: string;
	workspaceId: string;
}) {
	const queryClient = useQueryClient();

	const invalidateComments = () =>
		queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.reviewComments(workspaceId),
		});

	const addMutation = useMutation({
		mutationFn: (input: { body: string; lineNumber: number | null }) =>
			saveReviewComment({
				body: input.body,
				filePath,
				lineNumber: input.lineNumber,
				workspaceId,
			}),
		onError: notifyCommentFailed,
		onSuccess: invalidateComments,
	});
	const resolveMutation = useMutation({
		mutationFn: (input: { id: string; resolved: boolean }) =>
			saveReviewComment({
				id: input.id,
				status: input.resolved ? 'resolved' : 'open',
				workspaceId,
			}),
		onError: notifyCommentFailed,
		onSuccess: invalidateComments,
	});
	const deleteMutation = useMutation({
		mutationFn: (id: string) => deleteReviewComment({ id, workspaceId }),
		onError: notifyCommentFailed,
		onSuccess: invalidateComments,
	});

	return {
		onAddComment: (input: { body: string; lineNumber: number | null }) =>
			addMutation.mutate(input),
		onDeleteComment: (id: string) => {
			const local = localCommentId(id);
			if (local) {
				deleteMutation.mutate(local);
			}
		},
		onResolveComment: (id: string, resolved: boolean) => {
			const local = localCommentId(id);
			if (local) {
				resolveMutation.mutate({ id: local, resolved });
			}
		},
	};
}
