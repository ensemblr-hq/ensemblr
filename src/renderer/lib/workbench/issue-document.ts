/**
 * Renders a tracker issue as a standalone markdown document the composer can
 * store and attach. Deliberately un-localized: this text is written for the
 * agent, which `buildLanguageDirective` steers separately, so translating it
 * would make what the model reads vary by UI language.
 */

/** One labelled metadata row in an issue document's header. */
export interface IssueDocumentField {
	label: string;
	value: string | null | undefined;
}

/** One comment carried through to the issue document's discussion section. */
export interface IssueDocumentComment {
	author: string | null | undefined;
	body: string;
	createdAt?: string | null;
}

/**
 * Builds the filename an issue document is stored under, so the chip's tooltip
 * and the agent's `<attached_file path>` both name the issue rather than a hash.
 * @param provider - Tracker the issue came from.
 * @param reference - Human issue reference, such as `THE-106` or `#42`.
 * @returns A conservative filename stem plus its `.md` extension.
 */
export function issueDocumentFilename(
	provider: 'github' | 'linear',
	reference: string,
): string {
	const stem = reference
		.trim()
		.toLowerCase()
		.replaceAll(/[^a-z0-9_-]+/g, '-')
		.replaceAll(/^-+|-+$/g, '');
	return `${provider}-issue-${stem || 'unknown'}.md`;
}

/**
 * Renders the full issue — heading, metadata, body, and every comment — as
 * markdown. Unlike the one-line context block the composer used to inline, this
 * carries the whole issue so the agent never has to go and fetch it.
 * @param issue - The issue's heading fields, metadata rows, body, and comments.
 * @returns The markdown document to persist.
 */
export function renderIssueDocument({
	body,
	comments = [],
	fields,
	reference,
	title,
	url,
}: {
	body: string | null | undefined;
	comments?: readonly IssueDocumentComment[];
	fields: readonly IssueDocumentField[];
	reference: string;
	title: string;
	url?: string | null;
}): string {
	const sections = [`# ${reference}: ${title}`];
	const metadata = fields.flatMap((field) => {
		const value = field.value?.trim();
		return value ? [`- **${field.label}:** ${value}`] : [];
	});
	if (url?.trim()) {
		metadata.unshift(`- **URL:** ${url.trim()}`);
	}
	if (metadata.length > 0) {
		sections.push(metadata.join('\n'));
	}
	sections.push(
		body?.trim()
			? `## Description\n\n${body.trim()}`
			: '## Description\n\n_No description._',
	);
	if (comments.length > 0) {
		sections.push(
			`## Comments (${comments.length})\n\n${comments.map(renderComment).join('\n\n---\n\n')}`,
		);
	}
	return `${sections.join('\n\n')}\n`;
}

/**
 * Renders one comment with its attribution line above the body.
 * @param comment - The comment to render.
 * @returns The markdown block for that comment.
 */
function renderComment(comment: IssueDocumentComment): string {
	const author = comment.author?.trim() || 'Unknown';
	const when = comment.createdAt?.trim()
		? ` — ${comment.createdAt.trim()}`
		: '';
	return `**${author}**${when}\n\n${comment.body.trim()}`;
}
