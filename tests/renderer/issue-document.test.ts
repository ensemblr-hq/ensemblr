import { describe, expect, test } from 'vitest';

import { formatGithubIssueDocument } from '../../src/renderer/lib/github';
import { formatLinearIssueDocument } from '../../src/renderer/lib/linear';
import { issueDocumentFilename } from '../../src/renderer/lib/workbench/issue-document';
import type { LinearIssueWire } from '../../src/shared/ipc/contracts/linear';
import type { RepositoryIssueWire } from '../../src/shared/ipc/contracts/workspace-sources';

function linearIssue(
	overrides: Partial<LinearIssueWire> = {},
): LinearIssueWire {
	return {
		archivedAt: null,
		assigneeId: null,
		assigneeName: 'Ada',
		cycleId: null,
		cycleName: null,
		description: 'The composer drops attachments on send.',
		dueDate: null,
		id: 'issue-1',
		identifier: 'ENG-106',
		labels: [{ color: null, id: 'l1', name: 'bug' }],
		priority: 1,
		projectId: null,
		projectName: 'Ensemble',
		stateColor: null,
		stateId: null,
		stateName: 'In Progress',
		stateType: null,
		syncedAt: null,
		teamId: null,
		teamKey: null,
		teamName: 'Example Org',
		title: 'Attachments vanish on send',
		updatedAt: '2026-08-11T10:00:00.000Z',
		url: 'https://linear.app/x/issue/ENG-106',
		...overrides,
	};
}

function githubIssue(
	overrides: Partial<RepositoryIssueWire> = {},
): RepositoryIssueWire {
	return {
		authorLogin: 'octocat',
		body: 'Steps to reproduce:\n\n1. Paste a file\n2. Send',
		labels: ['bug', 'composer'],
		number: 42,
		state: 'OPEN',
		title: 'Paste loses the file',
		updatedAt: '2026-08-11T10:00:00.000Z',
		url: 'https://github.com/o/r/issues/42',
		...overrides,
	};
}

describe('issueDocumentFilename', () => {
	test('builds a readable filename from the issue reference', () => {
		expect(issueDocumentFilename('linear', 'ENG-106')).toBe(
			'linear-issue-eng-106.md',
		);
		expect(issueDocumentFilename('github', '#42')).toBe('github-issue-42.md');
	});

	test('falls back rather than emitting a bare extension', () => {
		expect(issueDocumentFilename('github', '###')).toBe(
			'github-issue-unknown.md',
		);
	});
});

describe('formatLinearIssueDocument', () => {
	test('carries the whole issue, its metadata, and its comments', () => {
		const document = formatLinearIssueDocument(linearIssue(), [
			{
				authorName: 'Grace',
				body: 'Reproduced on main.',
				createdAt: '2026-08-11T11:00:00.000Z',
				id: 'c1',
			},
		]);

		expect(document).toContain('# ENG-106: Attachments vanish on send');
		expect(document).toContain('- **URL:** https://linear.app/x/issue/ENG-106');
		expect(document).toContain('- **Status:** In Progress');
		expect(document).toContain('- **Priority:** Urgent');
		expect(document).toContain('- **Assignee:** Ada');
		expect(document).toContain('- **Labels:** bug');
		expect(document).toContain('The composer drops attachments on send.');
		expect(document).toContain('## Comments (1)');
		expect(document).toContain('**Grace**');
		expect(document).toContain('Reproduced on main.');
	});

	test('omits empty metadata rows and says so when there is no description', () => {
		const document = formatLinearIssueDocument(
			linearIssue({ description: null, projectName: null }),
		);

		expect(document).not.toContain('**Project:**');
		expect(document).toContain('_No description._');
		expect(document).not.toContain('## Comments');
	});

	test('is not truncated the way the old one-line context block was', () => {
		const description = 'x'.repeat(5_000);
		const document = formatLinearIssueDocument(linearIssue({ description }));

		expect(document).toContain(description);
	});
});

describe('formatGithubIssueDocument', () => {
	test('carries the whole body and the issue metadata', () => {
		const document = formatGithubIssueDocument(githubIssue());

		expect(document).toContain('# #42: Paste loses the file');
		expect(document).toContain('- **URL:** https://github.com/o/r/issues/42');
		expect(document).toContain('- **Status:** open');
		expect(document).toContain('- **Author:** octocat');
		expect(document).toContain('- **Labels:** bug, composer');
		expect(document).toContain('1. Paste a file');
	});

	test('handles an issue with no body', () => {
		const document = formatGithubIssueDocument(githubIssue({ body: '' }));

		expect(document).toContain('_No description._');
	});
});
