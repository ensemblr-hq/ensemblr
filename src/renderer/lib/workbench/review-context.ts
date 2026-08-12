import type {
	PullRequestCommentSummary,
	PullRequestTodoSummary,
} from '@/renderer/types/workbench';

/**
 * Conservative payload cap for review context inserted into the agent composer.
 * The agent does not report context usage ahead of submit, so blocks are truncated
 * with an explicit marker instead of silently overflowing (ENS-053).
 */
export const REVIEW_CONTEXT_CHAR_LIMIT = 24_000;

/** Truncates a context block at the cap, appending an explicit marker. */
export function clampReviewContext(text: string): string {
	if (text.length <= REVIEW_CONTEXT_CHAR_LIMIT) {
		return text;
	}
	return `${text.slice(0, REVIEW_CONTEXT_CHAR_LIMIT)}\n…[truncated — full content exceeds the review context limit]`;
}

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
