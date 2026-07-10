/**
 * Builds the first-prompt composer draft for a workspace created from an issue:
 * a heading line (`reference title`), the full issue body, and the issue link.
 * Offered for the user to edit and send — never auto-submitted.
 *
 * Distinct from the compact `format{Github,Linear}IssueContext` citations (used
 * when manually inserting an issue link): this seed pastes the issue *contents*,
 * so the body is included in full, capped only to stop a pathological body from
 * flooding the composer.
 */

/** Upper bound on the pasted issue body; longer bodies are truncated with `…`. */
const COMPOSER_BODY_MAX = 8000;

/** Minimal linked-issue shape needed to seed the composer draft. */
export interface LinkedIssueComposerSeedInput {
	description?: string;
	reference: string;
	title: string;
	url?: string;
}

/** Formats a linked issue's contents into the first-prompt composer draft. */
export function formatLinkedIssueComposerSeed(
	issue: LinkedIssueComposerSeedInput,
): string {
	const header = `${issue.reference} ${issue.title}`.trim();
	const description = issue.description?.trim();
	const body = description
		? `\n\n${truncateBody(description, COMPOSER_BODY_MAX)}`
		: '';
	const link = issue.url ? `\n\n${issue.url}` : '';
	return `${header}${body}${link}`;
}

/**
 * Truncates text to a maximum length, appending an ellipsis when it is clipped.
 * @param text - The text to truncate
 * @param maxLength - Maximum length before truncation
 * @returns The original text, or a clipped version ending in an ellipsis
 */
function truncateBody(text: string, maxLength: number): string {
	return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
