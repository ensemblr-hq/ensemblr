import type {
	PullRequestCommentSummary,
	PullRequestTodoSummary,
} from '@/renderer/types/workbench';
import { clampReviewContext } from '@/shared/review-brief';

export {
	clampReviewContext,
	REVIEW_CONTEXT_CHAR_LIMIT,
} from '@/shared/review-brief';

/**
 * Whether a comment still reads as work the agent could pick up. A comment with
 * no resolution state at all — a plain issue comment, a bot annotation — counts
 * as outstanding, because nothing has said otherwise and CI feedback is work.
 *
 * Deliberately looser than the merge dialog's unresolved count, which gates on
 * explicitly-open threads only: a bot annotation can never be resolved, so
 * counting it there would raise a merge warning the user cannot clear.
 * @param comment - The comment to classify
 * @returns True unless the comment is explicitly resolved
 */
export function isOutstandingComment(
	comment: PullRequestCommentSummary,
): boolean {
	return comment.isResolved !== true;
}

/** Formats a workspace todo for agent context. */
export function formatTodoContext(todo: PullRequestTodoSummary): string {
	return clampReviewContext(
		`Workspace review todo: ${todo.label}\nPlease address this item.`,
	);
}

/** Formats a unified file diff for agent context. */
export function formatFileDiffContext({
	filePath,
	patch,
}: {
	filePath: string;
	patch: string;
}): string {
	return clampReviewContext(
		[
			`Current diff for \`${filePath}\` (working tree vs HEAD):`,
			'```diff',
			patch.trimEnd(),
			'```',
		].join('\n'),
	);
}
