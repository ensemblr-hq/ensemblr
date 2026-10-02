/**
 * How a PR comment becomes a session tab. The comment rides inline on the tab's
 * SQLite metadata as a `document` tab, so a preview survives a reload without
 * re-fetching the PR (and without widening the `chat_tabs.kind` CHECK
 * constraint). Writing and reading live together here: the persisted shape is an
 * allowlist, so a future `PullRequestCommentSummary` field cannot leak unintended
 * or non-serializable data into the database, and the parser trusts nothing it
 * cannot type-check on the way back.
 */

import { formatCommentLocation } from '@/renderer/lib/workbench/comment-body';
import type {
	CommentPreviewPayload,
	PullRequestCommentReplySummary,
	PullRequestCommentSummary,
} from '@/renderer/types/workbench';

const COMMENT_PREVIEW_PROVIDERS: ReadonlySet<string> = new Set([
	'github',
	'github-actions',
	'linear',
	'local',
]);

/**
 * Names a comment tab by the file and line it anchors to, so a PR's review
 * threads stay apart in the tab strip — one bot leaves several, and every tab
 * reading `Comment · github-actions` truncates to the same thing.
 * @param comment - The comment the tab previews
 * @returns The tab title
 */
export function buildCommentTabTitle(
	comment: PullRequestCommentSummary,
): string {
	const location = formatCommentLocation(
		comment.path?.split('/').at(-1),
		comment.line,
	);
	if (location) {
		return location;
	}
	const author = comment.author?.trim();
	return author ? `Comment · ${author}` : 'Comment';
}

/**
 * Reduces a comment to the fields a preview tab persists.
 * @param comment - The comment being opened
 * @param prNumber - The pull request it belongs to, when known
 * @returns The tab's `commentPreview` metadata payload
 */
export function toCommentPreviewMetadata(
	comment: PullRequestCommentSummary,
	prNumber?: number,
): Record<string, unknown> {
	return {
		...toPersistedCommentFields(comment),
		body: comment.body,
		detail: comment.detail,
		id: comment.id,
		provider: comment.provider,
		...(comment.replies === undefined
			? {}
			: { replies: comment.replies.map(toPersistedReply) }),
		...(typeof prNumber === 'number' ? { prNumber } : {}),
	};
}

/** The optional head-comment fields worth persisting, when the comment has them. */
function toPersistedCommentFields(
	comment: PullRequestCommentSummary,
): Record<string, unknown> {
	return {
		...(comment.author === undefined ? {} : { author: comment.author }),
		...(comment.createdAt === undefined
			? {}
			: { createdAt: comment.createdAt }),
		...(comment.isOutdated === undefined
			? {}
			: { isOutdated: comment.isOutdated }),
		...(comment.isResolved === undefined
			? {}
			: { isResolved: comment.isResolved }),
		...(comment.line === undefined ? {} : { line: comment.line }),
		...(comment.path === undefined ? {} : { path: comment.path }),
		...(comment.url === undefined ? {} : { url: comment.url }),
	};
}

/** The reply fields worth persisting, under the same allowlist as the head comment. */
function toPersistedReply(
	reply: PullRequestCommentReplySummary,
): Record<string, unknown> {
	return {
		...(reply.author === undefined ? {} : { author: reply.author }),
		body: reply.body,
		...(reply.createdAt === undefined ? {} : { createdAt: reply.createdAt }),
		id: reply.id,
	};
}

/**
 * Defensively parses the inline comment payload carried on a `document` tab's
 * metadata (untyped wire `Record<string, unknown>`). Returns `undefined` for
 * regular document tabs or malformed payloads so hydration degrades gracefully.
 * @param value - The tab's untyped `commentPreview` metadata
 * @returns The comment payload, or undefined when the tab carries none
 */
export function parseCommentPreview(
	value: unknown,
): CommentPreviewPayload | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const { detail, id, provider } = record;
	if (
		typeof id !== 'string' ||
		typeof detail !== 'string' ||
		typeof provider !== 'string' ||
		!COMMENT_PREVIEW_PROVIDERS.has(provider)
	) {
		return undefined;
	}
	const replies = parseCommentReplies(record.replies);
	return {
		...parseOptionalCommentFields(record),
		// Tabs persisted before the body travelled inline only carry `detail`.
		body: typeof record.body === 'string' ? record.body : detail,
		detail,
		id,
		provider: provider as CommentPreviewPayload['provider'],
		...(replies.length > 0 ? { replies } : {}),
	};
}

/** The optional head-comment fields that survive a type check on the way back. */
function parseOptionalCommentFields(
	record: Record<string, unknown>,
): Partial<CommentPreviewPayload> {
	return {
		...(typeof record.author === 'string' ? { author: record.author } : {}),
		...(typeof record.createdAt === 'string'
			? { createdAt: record.createdAt }
			: {}),
		...(typeof record.isOutdated === 'boolean'
			? { isOutdated: record.isOutdated }
			: {}),
		...(typeof record.isResolved === 'boolean'
			? { isResolved: record.isResolved }
			: {}),
		...(typeof record.line === 'number' ? { line: record.line } : {}),
		...(typeof record.path === 'string' ? { path: record.path } : {}),
		...(typeof record.prNumber === 'number'
			? { prNumber: record.prNumber }
			: {}),
		...(typeof record.url === 'string' ? { url: record.url } : {}),
	};
}

/**
 * Parses persisted thread replies, dropping any entry missing the body or id the
 * preview needs to render it.
 * @param value - The untyped `replies` field from tab metadata
 * @returns The well-formed replies, in order
 */
function parseCommentReplies(value: unknown): PullRequestCommentReplySummary[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((entry) => {
		if (typeof entry !== 'object' || entry === null) {
			return [];
		}
		const record = entry as Record<string, unknown>;
		if (typeof record.id !== 'string' || typeof record.body !== 'string') {
			return [];
		}
		return [
			{
				...(typeof record.author === 'string' ? { author: record.author } : {}),
				body: record.body,
				...(typeof record.createdAt === 'string'
					? { createdAt: record.createdAt }
					: {}),
				id: record.id,
			},
		];
	});
}
