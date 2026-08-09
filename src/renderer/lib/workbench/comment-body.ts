/**
 * PR comment bodies arrive wrapped in machine metadata that renders as nothing
 * but dominates any plain-text preview: Vercel packs a base64 state blob into a
 * link-reference definition, and most bots open with an HTML comment marker.
 * These helpers strip that noise and reduce what is left to one line of prose,
 * so a comment row says what its author wrote rather than what its bot encoded.
 */

import { i18n } from '@/renderer/lib/i18n';

const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const HTML_TAG = /<[^>]*>/g;
const BLANK_LINE_RUN = /\n{3,}/g;
const EMPHASIS_MARKER = /[*_`~]/g;
const HORIZONTAL_RULE = /^\s*(?:[-*_]\s*){3,}$/;
const LEADING_MARKDOWN_MARKER = /^\s*(?:>\s*|#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)+/;
const DIVIDER_RUN = /^[\s:|-]+$/;
const WHITESPACE_RUN = /\s+/g;

/**
 * A link-reference definition pointing at an over-long fragment, which is how
 * bots smuggle state into a comment (`[vc]: #<hash>=:<base64>`). Genuine in-page
 * anchors are far shorter, so the length bound keeps real content intact.
 */
const METADATA_DEFINITION = /^[ \t]*\[[^\]]*\]:[ \t]*#\S{24,}[ \t]*$/gm;

const SUMMARY_CHAR_LIMIT = 200;

/**
 * Removes machine-only markup — HTML comment markers and metadata link
 * definitions — from a comment body, leaving the markdown a human wrote.
 * @param body - The raw comment body
 * @returns The body with metadata and the gaps it leaves removed
 */
export function stripCommentMetadata(body: string): string {
	return body
		.replace(HTML_COMMENT, '')
		.replace(METADATA_DEFINITION, '')
		.replace(BLANK_LINE_RUN, '\n\n')
		.trim();
}

/**
 * Whether a line is the `| --- | :--: |` rule separating a markdown table's
 * header from its body, which carries no prose worth summarizing. Tested as a
 * single pass over the line rather than a pattern with two open-ended runs of
 * divider characters, whose ambiguous split point costs quadratic time on the
 * long lines a comment body is free to contain.
 * @param line - A single line of the comment body
 * @returns True when the line is a table divider
 */
function isTableDivider(line: string): boolean {
	return line.includes('|') && DIVIDER_RUN.test(line);
}

/**
 * Reduces one body line to plain summary text, unwrapping markdown and HTML.
 * @param line - A single line of the comment body
 * @returns The line as plain prose, or empty when it carries none
 */
function toSummaryLine(line: string): string {
	if (HORIZONTAL_RULE.test(line) || isTableDivider(line)) {
		return '';
	}
	return line
		.replace(HTML_TAG, ' ')
		.replace(LEADING_MARKDOWN_MARKER, '')
		.replace(EMPHASIS_MARKER, '')
		.replace(WHITESPACE_RUN, ' ')
		.trim();
}

/**
 * Reduces a comment body to its first line of prose for a one-line row label.
 * Metadata, blank leads, rules, and table dividers are skipped, so a body that
 * opens with a bot marker still summarizes as the sentence underneath it.
 * @param body - The raw comment body
 * @returns The first line of prose, truncated, or empty when the body has none
 */
export function summarizeCommentBody(body: string): string {
	for (const line of stripCommentMetadata(body).split('\n')) {
		const summary = toSummaryLine(line);
		if (!summary) {
			continue;
		}
		return summary.length > SUMMARY_CHAR_LIMIT
			? `${summary.slice(0, SUMMARY_CHAR_LIMIT).trimEnd()}…`
			: summary;
	}
	return '';
}

/**
 * Formats a comment's diff anchor as `path:line`.
 * @param path - Repository-relative path the comment anchors to
 * @param line - Line within that path, when the comment is not file-level
 * @returns The location label, or empty when the comment has no path
 */
export function formatCommentLocation(path?: string, line?: number): string {
	if (!path) {
		return '';
	}
	return line === undefined ? path : `${path}:${line}`;
}

/**
 * Builds the one-line label for a comment row, preferring the body's prose and
 * falling back through its replies to the diff location, so a thread whose head
 * comment is empty still identifies itself.
 * @param comment - The comment's body, diff anchor, and replies
 * @returns The row label; never empty
 */
export function describeComment({
	body,
	line,
	path,
	replies = [],
}: {
	body: string;
	line?: number;
	path?: string;
	replies?: readonly { body: string }[];
}): string {
	const summary = summarizeCommentBody(body);
	if (summary) {
		return summary;
	}
	for (const reply of replies) {
		const replySummary = summarizeCommentBody(reply.body);
		if (replySummary) {
			return replySummary;
		}
	}
	return (
		formatCommentLocation(path, line) ||
		i18n.t('review:comment.no-description', 'No description')
	);
}
