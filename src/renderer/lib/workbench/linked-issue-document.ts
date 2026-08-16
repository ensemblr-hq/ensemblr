/**
 * Renders a workspace's linked-issue summary as an attachable markdown document.
 *
 * The fallback for the seeded attachment: `format{Github,Linear}IssueDocument`
 * need the live wire row, which is not always reachable — a GitHub issue is
 * remembered only by its URL, and Linear may be disconnected or rate-limited.
 * The summary persisted on the workspace still carries reference, title,
 * description, and URL, and an attachment built from those beats no attachment
 * at all.
 */

import { renderIssueDocument } from '@/renderer/lib/workbench/issue-document';
import type { WorkspaceLinkedIssueSummary } from '@/renderer/types/workbench';

/**
 * Renders the linked-issue summary stored on a workspace as an issue document.
 * @param linkedIssue - The summary captured when the workspace was created.
 * @returns The markdown document to attach.
 */
export function formatLinkedIssueDocument(
	linkedIssue: WorkspaceLinkedIssueSummary,
): string {
	return renderIssueDocument({
		body: linkedIssue.description,
		fields: [{ label: 'Team', value: linkedIssue.subtitle }],
		reference: linkedIssue.reference,
		title: linkedIssue.title,
		url: linkedIssue.url,
	});
}
