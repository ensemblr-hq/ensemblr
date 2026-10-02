import type { DynamicToolUIPart } from 'ai';
import { i18n } from '@/renderer/lib/i18n';
import {
	bold,
	type ControlRow,
	clamp,
	codeSpan,
	controlAck,
	controlPayloadRecord,
	controlPayloadRows,
	excerpt,
	isRecord,
	joinFacts,
	listRow,
	markdownBlocks,
	markdownList,
	markdownRow,
	numberValue,
	ROW_EXCERPT_LIMIT,
	stringValue,
} from './ensemblr-control-presenter-helpers';

/**
 * How the Linear and review-comment control ops read once a row is opened.
 *
 * Both surfaces are the same shape of problem: the payload is a list of records
 * a person wrote, and the useful part of each one is prose. Rendering that as
 * JSON is the one form in which none of it can be read — an issue description
 * arrives with its newlines escaped, and a review comment arrives as a field of
 * a row of an array.
 *
 * Titles, glyphs, and chips stay with `ensemblr-control-tool-registry.ts`. The
 * registry already puts an issue's identifier in the title of a `get_issue`
 * row, so the preview here carries its state and comment count instead.
 */

/** Longest an issue description runs inside a row before it stops being a preview. */
const DESCRIPTION_LIMIT = 1_200;

/**
 * Renders one issue as a list row: the key a branch or PR would cite, the
 * title, and the two fields that decide whether it is the one being looked for.
 * @param issue - One untrusted `AgentLinearIssue` row
 * @returns The rendered row, or null when the row carries no identifier
 */
function issueRow(issue: unknown): string | null {
	if (!isRecord(issue)) {
		return null;
	}
	const identifier = stringValue(issue, 'identifier');
	if (identifier === null) {
		return null;
	}
	const title = stringValue(issue, 'title');
	return joinFacts([
		codeSpan(identifier),
		title === null ? null : bold(title),
		stringValue(issue, 'state'),
		stringValue(issue, 'assignee'),
	]);
}

/**
 * Presents an issue search. Descriptions are deliberately absent from this
 * payload, so the row carries what a list view is read for: which issues came
 * back, and whether the search was narrow enough to have returned all of them.
 * @param part - The `ensemblr_linear_list_issues` tool part to project
 * @returns The row's body and collapsed summary
 */
function presentListIssues(part: DynamicToolUIPart): ControlRow {
	const payload = controlPayloadRecord(part);
	if (payload === null) {
		return controlAck();
	}
	const issues = Array.isArray(payload.issues) ? payload.issues : [];
	const rendered = issues.flatMap((issue) => {
		const row = issueRow(issue);
		return row === null ? [] : [row];
	});
	const omitted = numberValue(payload, 'omittedIssues') ?? 0;
	const body = markdownBlocks([
		rendered.length === 0 ? null : markdownList(rendered),
		omitted > 0
			? i18n.t('workbench:control-tool.linear.omitted-issues', {
					count: omitted,
					defaultValue_one:
						'{{count}} more issue did not fit — narrow the search.',
					defaultValue_other:
						'{{count}} more issues did not fit — narrow the search.',
				})
			: null,
		rendered.length === 0 ? stringValue(payload, 'message') : null,
	]);
	return markdownRow(
		body,
		i18n.t('workbench:control-tool.preview.issues', {
			count: rendered.length,
			defaultValue_one: '{{count}} issue',
			defaultValue_other: '{{count}} issues',
		}),
	);
}

/**
 * Renders the facts about an issue that sit above its description.
 * @param issue - The untrusted `AgentLinearIssueDetail`
 * @returns The rendered meta line, empty when the payload reported none
 */
function issueMeta(issue: Record<string, unknown>): string {
	const labels = Array.isArray(issue.labels)
		? issue.labels.filter((label): label is string => typeof label === 'string')
		: [];
	const priority = numberValue(issue, 'priority');
	return joinFacts([
		stringValue(issue, 'state'),
		stringValue(issue, 'assignee'),
		stringValue(issue, 'team'),
		stringValue(issue, 'project'),
		stringValue(issue, 'cycle'),
		priority === null
			? null
			: i18n.t(
					'workbench:control-tool.linear.priority',
					'priority {{priority}}',
					{
						priority,
					},
				),
		labels.length === 0 ? null : labels.join(', '),
	]);
}

/**
 * Renders one comment as its author and body, so a thread reads as a
 * conversation rather than as rows of a table.
 * @param comment - One untrusted `AgentLinearComment`
 * @returns The rendered block, or null when the comment carries no body
 */
function commentBlock(comment: unknown): string | null {
	if (!isRecord(comment)) {
		return null;
	}
	const body = stringValue(comment, 'body');
	if (body === null) {
		return null;
	}
	const author =
		stringValue(comment, 'author') ??
		i18n.t('workbench:control-tool.linear.unknown-author', 'Unknown');
	return `- ${bold(author)} — ${excerpt(body, ROW_EXCERPT_LIMIT)}`;
}

/**
 * Presents one issue read on its own: its heading, the fields a list view omits,
 * its description, and the thread beneath it.
 * @param part - The `ensemblr_linear_get_issue` tool part to project
 * @returns The row's body and collapsed summary
 */
function presentGetIssue(part: DynamicToolUIPart): ControlRow {
	const payload = controlPayloadRecord(part);
	if (payload === null) {
		return controlAck();
	}
	const issue = isRecord(payload.issue) ? payload.issue : null;
	if (issue === null) {
		const message = stringValue(payload, 'message');
		return message === null ? controlAck() : markdownRow(message, null);
	}
	const comments = Array.isArray(payload.comments) ? payload.comments : [];
	const renderedComments = comments.flatMap((comment) => {
		const block = commentBlock(comment);
		return block === null ? [] : [block];
	});
	const description = stringValue(issue, 'description');
	const omittedComments = numberValue(payload, 'omittedComments') ?? 0;
	const body = markdownBlocks([
		issueMeta(issue),
		description === null ? null : clamp(description, DESCRIPTION_LIMIT),
		renderedComments.length === 0
			? null
			: markdownBlocks([
					`### ${i18n.t('workbench:control-tool.linear.comments-heading', 'Comments')}`,
					renderedComments.join('\n'),
				]),
		omittedComments > 0
			? i18n.t('workbench:control-tool.linear.omitted-comments', {
					count: omittedComments,
					defaultValue_one: '{{count}} earlier comment did not fit.',
					defaultValue_other: '{{count}} earlier comments did not fit.',
				})
			: null,
	]);
	return markdownRow(
		body,
		joinFacts([
			stringValue(issue, 'state'),
			i18n.t('workbench:control-tool.preview.comments', {
				count: renderedComments.length,
				defaultValue_one: '{{count}} comment',
				defaultValue_other: '{{count}} comments',
			}),
		]),
	);
}

/**
 * Localizes a review comment's lifecycle status, reusing the Changes panel's own
 * labels so a row and the panel never disagree about what a state is called.
 * @param status - The status as the payload reported it
 * @returns The localized label, or the raw value when it is not a known state
 */
function commentStatusLabel(status: string | null): string | null {
	switch (status) {
		case 'archived':
			return i18n.t('workbench:control-tool.review.archived', 'Archived');
		case 'open':
			return i18n.t('review:comment.unresolved', 'Unresolved');
		case 'resolved':
			return i18n.t('review:comment.resolved', 'Resolved');
		default:
			return status;
	}
}

/**
 * Names who left a review comment, which is what decides whether it is a
 * finding to act on or one already answered.
 * @param origin - The origin as the payload reported it
 * @returns The localized label, or the raw value when it is not a known origin
 */
function commentOriginLabel(origin: string | null): string | null {
	switch (origin) {
		case 'agent':
			return i18n.t('workbench:control-tool.review.by-agent', 'Agent');
		case 'user':
			return i18n.t('workbench:control-tool.review.by-user', 'You');
		default:
			return origin;
	}
}

/**
 * Presents the review comments standing on a workspace's diff. Each row names
 * the line it is against, who left it, and whether it is still open — which is
 * the whole question a reader of this listing has.
 * @param part - The `ensemblr_get_diff_comments` tool part to project
 * @returns The row's body and collapsed summary
 */
function presentGetDiffComments(part: DynamicToolUIPart): ControlRow {
	const rows = controlPayloadRows(part, 'comments');
	if (rows === null) {
		return controlAck();
	}
	const rendered = rows.flatMap((comment) => {
		if (!isRecord(comment)) {
			return [];
		}
		const filePath = stringValue(comment, 'filePath');
		if (filePath === null) {
			return [];
		}
		const line = numberValue(comment, 'lineNumber');
		const body = stringValue(comment, 'body');
		return [
			joinFacts([
				codeSpan(line === null ? filePath : `${filePath}:${line}`),
				commentOriginLabel(stringValue(comment, 'origin')),
				commentStatusLabel(stringValue(comment, 'status')),
				body === null ? null : excerpt(body, ROW_EXCERPT_LIMIT),
			]),
		];
	});
	return listRow(
		rendered,
		i18n.t('workbench:control-tool.preview.comments', {
			count: rendered.length,
			defaultValue_one: '{{count}} comment',
			defaultValue_other: '{{count}} comments',
		}),
	);
}

/**
 * Presents a batch resolve. A clean run has nothing to unfold, but a partial one
 * has to say which ids it could not close — that is the whole reason the op
 * reports them separately rather than as a count.
 * @param part - The `ensemblr_resolve_diff_comments` tool part to project
 * @returns The row's body and collapsed summary
 */
function presentResolveDiffComments(part: DynamicToolUIPart): ControlRow {
	const payload = controlPayloadRecord(part);
	if (payload === null) {
		return controlAck();
	}
	const notFound = Array.isArray(payload.notFound)
		? payload.notFound.filter((id): id is string => typeof id === 'string')
		: [];
	const alreadyResolved = Array.isArray(payload.alreadyResolved)
		? payload.alreadyResolved.filter(
				(id): id is string => typeof id === 'string',
			)
		: [];
	const resolved = numberValue(payload, 'resolved') ?? 0;
	const body = markdownBlocks([
		alreadyResolved.length === 0
			? null
			: markdownBlocks([
					`### ${i18n.t('workbench:control-tool.review.already-resolved-heading', 'Already resolved')}`,
					markdownList(alreadyResolved.map(codeSpan)),
				]),
		notFound.length === 0
			? null
			: markdownBlocks([
					`### ${i18n.t('workbench:control-tool.review.not-found-heading', 'Not found')}`,
					markdownList(notFound.map(codeSpan)),
				]),
	]);
	return markdownRow(
		body,
		joinFacts([
			i18n.t('workbench:control-tool.preview.resolved', {
				count: resolved,
				defaultValue_one: '{{count}} resolved',
				defaultValue_other: '{{count}} resolved',
			}),
			notFound.length === 0
				? null
				: i18n.t('workbench:control-tool.preview.not-found', {
						count: notFound.length,
						defaultValue_one: '{{count}} not found',
						defaultValue_other: '{{count}} not found',
					}),
		]),
	);
}

/** Linear and review-comment control ops, keyed by their canonical tool name. */
export const ENSEMBLR_LINEAR_TOOL_PRESENTERS: Record<
	string,
	(part: DynamicToolUIPart) => ControlRow
> = {
	ensemblr_get_diff_comments: presentGetDiffComments,
	ensemblr_linear_get_issue: presentGetIssue,
	ensemblr_linear_list_issues: presentListIssues,
	ensemblr_resolve_diff_comments: presentResolveDiffComments,
};
