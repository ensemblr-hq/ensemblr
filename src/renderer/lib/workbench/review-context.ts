import type {
	PullRequestCommentSummary,
	PullRequestTodoSummary,
} from '@/renderer/types/workbench';
import { formatCommentLocation } from './comment-body';

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
 * Formats one PR comment (GitHub or local) for agent context, carrying the full
 * body and every thread reply rather than the row's one-line summary.
 */
export function formatCommentContext(
	comment: PullRequestCommentSummary,
	prNumber?: number,
): string {
	const lines = [`${describeCommentSource(comment, prNumber)}:`, comment.body];
	for (const reply of comment.replies ?? []) {
		lines.push('', `Reply from ${reply.author ?? 'unknown'}:`, reply.body);
	}
	if (comment.url) {
		lines.push(`Link: ${comment.url}`);
	}
	if (typeof comment.isResolved === 'boolean') {
		lines.push(
			comment.isResolved ? 'Thread is resolved.' : 'Thread is unresolved.',
		);
	}
	if (comment.isOutdated) {
		lines.push('Thread is outdated against the current diff.');
	}
	return clampReviewContext(lines.join('\n'));
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

/**
 * Builds the attribution line that opens a comment's context block: where the
 * comment came from and, when known, which file and line it anchors to.
 * @param comment - The comment being formatted
 * @param prNumber - The pull request the comment belongs to, when known
 * @returns The attribution line, without its trailing colon
 */
function describeCommentSource(
	comment: PullRequestCommentSummary,
	prNumber?: number,
): string {
	const source =
		comment.provider === 'local'
			? 'Local review comment'
			: `GitHub comment${prNumber ? ` on PR #${prNumber}` : ''}`;
	const location = formatCommentLocation(comment.path, comment.line);
	return location ? `${source} on ${location}` : source;
}

/**
 * Labels one comment inside the bulk block. The row summary is prose alone, so
 * without this the numbered lines carry no author and no file — the agent would
 * be handed a list it cannot attribute or act on.
 * @param comment - The comment being labelled
 * @param prNumber - The pull request the comment belongs to, when known
 * @returns The label that precedes the comment's summary
 */
function describeCommentLabel(
	comment: PullRequestCommentSummary,
	prNumber?: number,
): string {
	const source = describeCommentSource(comment, prNumber);
	const author = comment.provider === 'local' ? undefined : comment.author;
	return author ? `${author} — ${source}` : source;
}

/** Formats the given PR comments into one context block ("Add all to chat"). */
export function formatAllCommentsContext(
	comments: readonly PullRequestCommentSummary[],
	prNumber?: number,
): string {
	const header = `Review comments${prNumber ? ` for PR #${prNumber}` : ''} (${comments.length}):`;
	const body = comments
		.map(
			(comment, index) =>
				`${index + 1}. ${describeCommentLabel(comment, prNumber)} — ${comment.detail}`,
		)
		.join('\n');
	return clampReviewContext(
		`${header}\n${body}\nPlease address these review comments.`,
	);
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
