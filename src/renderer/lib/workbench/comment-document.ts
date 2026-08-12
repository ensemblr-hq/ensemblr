/**
 * Renders a review comment as a standalone markdown document the composer can
 * store and attach, so the agent reads the whole thread as a file rather than
 * being handed a pasted excerpt. Deliberately un-localized: this text is written
 * for the agent, which `buildLanguageDirective` steers separately, so
 * translating it would make what the model reads vary by UI language.
 */

import type {
	PullRequestCommentReplySummary,
	PullRequestCommentSummary,
} from '@/renderer/types/workbench';

import { formatCommentLocation } from './comment-body';

/** How each provider names itself in the document's source row. */
const PROVIDER_LABELS: Record<PullRequestCommentSummary['provider'], string> = {
	github: 'GitHub review comment',
	'github-actions': 'GitHub Actions comment',
	linear: 'Linear comment',
	local: 'Local review comment',
};

/** Who an Ensemblr-local comment is attributed to, by its recorded origin. */
const LOCAL_AUTHOR_LABELS = {
	agent: 'Ensemblr agent',
	user: 'Ensemblr user',
} as const;

/** Fallback stem for a comment whose location and id both sanitize to nothing. */
const UNKNOWN_STEM = 'unknown';

/**
 * The comment's diff anchor as `name:line`, using the file's basename rather
 * than its full path — a chip and a tab strip are both too narrow for one. Pure
 * path data, so it reads the same in every language.
 * @param comment - The comment being labelled
 * @returns The short anchor, or an empty string when the comment has no path
 */
export function commentAnchorLabel(comment: PullRequestCommentSummary): string {
	return formatCommentLocation(comment.path?.split('/').at(-1), comment.line);
}

/**
 * Who wrote the comment. A local comment spends its `author` slot on the
 * `path:line` location (see `localReviewCommentToSummary`), so its attribution
 * has to come from `origin` instead.
 * @param comment - The comment being attributed
 * @returns The author to print, or undefined when nothing identifies them
 */
function commentAuthor(comment: PullRequestCommentSummary): string | undefined {
	if (comment.provider === 'local') {
		return comment.origin ? LOCAL_AUTHOR_LABELS[comment.origin] : undefined;
	}
	return comment.author?.trim() || undefined;
}

/**
 * Reduces a value to a conservative filename stem.
 * @param value - The raw text to sanitize
 * @returns Lowercase alphanumerics, underscores, and hyphens only
 */
function toFilenameStem(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replaceAll(/[^a-z0-9_-]+/g, '-')
		.replaceAll(/^-+|-+$/g, '');
}

/**
 * Builds the filename a comment document is stored under, so the chip's tooltip
 * and the agent's `<attached_file path>` both name the comment's location rather
 * than a hash.
 * @param comment - The comment being written out
 * @returns A conservative filename stem plus its `.md` extension
 */
export function commentDocumentFilename(
	comment: PullRequestCommentSummary,
): string {
	const stem =
		toFilenameStem(commentAnchorLabel(comment)) ||
		toFilenameStem(comment.id) ||
		UNKNOWN_STEM;
	return `review-comment-${comment.provider}-${stem}.md`;
}

/**
 * How the thread's resolution reads, or undefined when the provider reports no
 * resolution state at all — a bot annotation is neither resolved nor open.
 * @param isResolved - The comment's resolution flag
 * @returns The state label, or undefined when there is none
 */
function threadStateLabel(isResolved?: boolean | null): string | undefined {
	if (typeof isResolved !== 'boolean') {
		return undefined;
	}
	return isResolved ? 'Resolved' : 'Unresolved';
}

/**
 * The document's metadata rows, in the order they are printed. Empty values are
 * dropped by {@link renderCommentDocument} rather than filtered here, so each
 * row stays a single expression.
 * @param comment - The comment being rendered
 * @param prNumber - The pull request the comment belongs to, when known
 * @returns Label/value pairs for the metadata list
 */
function commentMetadataRows(
	comment: PullRequestCommentSummary,
	prNumber?: number,
): readonly { label: string; value: string | undefined }[] {
	return [
		{ label: 'Source', value: PROVIDER_LABELS[comment.provider] },
		{ label: 'Author', value: commentAuthor(comment) },
		{
			label: 'Location',
			value: formatCommentLocation(comment.path, comment.line),
		},
		{
			label: 'Pull request',
			value: typeof prNumber === 'number' ? `#${prNumber}` : undefined,
		},
		{ label: 'Posted', value: comment.createdAt },
		{ label: 'URL', value: comment.url },
		{ label: 'Thread state', value: threadStateLabel(comment.isResolved) },
		{
			label: 'Outdated',
			value: comment.isOutdated
				? 'Yes — the thread no longer maps to the current diff'
				: undefined,
		},
	];
}

/**
 * Renders one reply with its attribution line above the body.
 * @param reply - The reply to render
 * @returns The markdown block for that reply
 */
function renderReply(reply: PullRequestCommentReplySummary): string {
	const author = reply.author?.trim() || 'Unknown';
	const when = reply.createdAt?.trim() ? ` — ${reply.createdAt.trim()}` : '';
	return `**${author}**${when}\n\n${reply.body.trim()}`;
}

/**
 * Renders the whole comment — heading, metadata, body, and every reply — as
 * markdown, so the agent has the full thread and the state it is in without
 * going back to the provider for it.
 * @param comment - The comment to write out
 * @param prNumber - The pull request the comment belongs to, when known
 * @returns The markdown document to persist
 */
export function renderCommentDocument(
	comment: PullRequestCommentSummary,
	prNumber?: number,
): string {
	const location = commentAnchorLabel(comment);
	const sections = [
		location ? `# Review comment on ${location}` : '# Review comment',
	];
	const metadata = commentMetadataRows(comment, prNumber).flatMap((row) => {
		const value = row.value?.trim();
		return value ? [`- **${row.label}:** ${value}`] : [];
	});
	if (metadata.length > 0) {
		sections.push(metadata.join('\n'));
	}
	sections.push(
		comment.body.trim()
			? `## Comment\n\n${comment.body.trim()}`
			: '## Comment\n\n_No content._',
	);
	const replies = comment.replies ?? [];
	if (replies.length > 0) {
		sections.push(
			`## Replies (${replies.length})\n\n${replies.map(renderReply).join('\n\n---\n\n')}`,
		);
	}
	return `${sections.join('\n\n')}\n`;
}
