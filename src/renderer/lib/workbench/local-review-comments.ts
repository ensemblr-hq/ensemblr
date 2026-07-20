import type { PullRequestCommentSummary } from '@/renderer/types/workbench';
import type { ReviewCommentWire } from '@/shared/ipc/contracts/review-comments';

/**
 * Final path segment of a workspace-relative file path, used to label a local
 * comment by its file rather than its full path.
 * @param path - The file path to reduce
 * @returns The basename, or the trimmed path when it has no separator
 */
function basenameOf(path: string): string {
	const trimmed = path.replace(/\/+$/, '');
	return trimmed.split('/').at(-1) ?? trimmed;
}

/**
 * Map a stored local review comment onto the shared comment-summary shape so the
 * Checks panel can render it in the same list as GitHub comments. The `path:line`
 * location fills the author slot (GitHub embeds its location in `detail`), and an
 * open comment reports as unresolved so it shows the same badge as GitHub threads.
 * @param comment - The stored local review comment
 * @returns The comment as a Checks-panel comment summary
 */
export function localReviewCommentToSummary(
	comment: ReviewCommentWire,
): PullRequestCommentSummary {
	const location =
		comment.lineNumber === null
			? basenameOf(comment.filePath)
			: `${basenameOf(comment.filePath)}:${comment.lineNumber}`;
	return {
		author: location,
		detail: comment.body,
		id: comment.id,
		isResolved: comment.status === 'resolved',
		provider: 'local',
	};
}

/**
 * Select the local review comments worth surfacing in the Checks panel —
 * everything except archived rows — as comment summaries.
 * @param comments - The workspace's stored local review comments
 * @returns The visible local comments as summaries, in the given order
 */
export function selectLocalReviewComments(
	comments: readonly ReviewCommentWire[],
): PullRequestCommentSummary[] {
	return comments
		.filter((comment) => comment.status !== 'archived')
		.map(localReviewCommentToSummary);
}
