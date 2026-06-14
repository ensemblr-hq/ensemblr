import type {
	PullRequestCheckSummary,
	PullRequestCommentSummary,
	PullRequestTodoSummary,
} from '@/renderer/types/workbench';

/**
 * Conservative payload cap for review context inserted into the Pi composer.
 * Pi does not report context usage ahead of submit, so blocks are truncated
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

/** Formats a failing/pending check row for Pi context. */
export function formatCheckContext(
	check: PullRequestCheckSummary,
	prNumber?: number,
): string {
	const lines = [
		`Failing check on PR${prNumber ? ` #${prNumber}` : ''}: ${check.label}`,
		`Status: ${check.status}`,
	];
	if (check.url) {
		lines.push(`Details: ${check.url}`);
	}
	lines.push('Please investigate the failure and propose a fix.');
	return clampReviewContext(lines.join('\n'));
}

/** Formats one PR comment (GitHub or local) for Pi context. */
export function formatCommentContext(
	comment: PullRequestCommentSummary,
	prNumber?: number,
): string {
	const source =
		comment.provider === 'local'
			? 'Local review comment'
			: `GitHub comment${prNumber ? ` on PR #${prNumber}` : ''}`;
	const lines = [`${source}:`, comment.detail];
	if (comment.url) {
		lines.push(`Link: ${comment.url}`);
	}
	if (comment.isResolved === false) {
		lines.push('Thread is unresolved.');
	}
	return clampReviewContext(lines.join('\n'));
}

/** Formats every PR comment into one context block ("Add all to chat"). */
export function formatAllCommentsContext(
	comments: readonly PullRequestCommentSummary[],
	prNumber?: number,
): string {
	const header = `Review comments${prNumber ? ` for PR #${prNumber}` : ''} (${comments.length}):`;
	const body = comments
		.map((comment, index) => `${index + 1}. ${comment.detail}`)
		.join('\n');
	return clampReviewContext(
		`${header}\n${body}\nPlease address these review comments.`,
	);
}

/** Formats a workspace todo for Pi context. */
export function formatTodoContext(todo: PullRequestTodoSummary): string {
	return clampReviewContext(
		`Workspace review todo: ${todo.label}\nPlease address this item.`,
	);
}

/** Formats a unified file diff for Pi context. */
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
