import { renderIssueDocument } from '@/renderer/lib/workbench/issue-document';
import type { GithubIssueWorkspaceSeed } from '@/renderer/types/github';
import type { WorkspaceSource } from '@/renderer/types/workbench';
import type { RepositoryIssueWire } from '@/shared/ipc/contracts/workspace-sources';

/** Stable picker-row id for a GitHub issue source. */
export function githubIssueSourceId(issueNumber: number): string {
	return `gh-issue:${issueNumber}`;
}

/**
 * Renders a GitHub issue as a full markdown document for the composer to store
 * and attach, carrying the whole body rather than a summary line.
 * @param issue - The issue to render.
 * @returns The markdown document to persist.
 */
export function formatGithubIssueDocument(issue: RepositoryIssueWire): string {
	return renderIssueDocument({
		body: issue.body,
		fields: [
			{ label: 'Status', value: issue.state?.toLowerCase() },
			{ label: 'Author', value: issue.authorLogin },
			{ label: 'Labels', value: issue.labels.join(', ') },
			{ label: 'Updated', value: issue.updatedAt },
		],
		reference: `#${issue.number}`,
		title: issue.title,
		url: issue.url,
	});
}

/** Maps live GitHub issues into create-from picker sources. */
export function mapGithubIssuesToWorkspaceSources(
	issues: RepositoryIssueWire[],
): WorkspaceSource[] {
	return issues.map((issue) => ({
		id: githubIssueSourceId(issue.number),
		kind: 'issue',
		provider: 'github',
		reference: `#${issue.number}`,
		subtitle: issue.state ? issue.state.toLowerCase() : undefined,
		title: issue.title,
	}));
}

/**
 * Builds the linked-issue record (including the issue body, which seeds the
 * first-prompt composer draft) for a workspace created from a GitHub issue.
 * Workspace name and branch follow the default path (composer surname,
 * placeholder, auto branch-naming) — only the composer is seeded from the issue.
 */
export function buildWorkspaceSeedFromGithubIssue(
	issue: RepositoryIssueWire,
): GithubIssueWorkspaceSeed {
	return {
		linkedIssue: {
			...(issue.body ? { description: issue.body } : {}),
			// The issue URL is a stable, globally-unique external id for the link.
			id: issue.url,
			identifier: `#${issue.number}`,
			provider: 'github',
			title: issue.title,
			url: issue.url,
		},
	};
}
