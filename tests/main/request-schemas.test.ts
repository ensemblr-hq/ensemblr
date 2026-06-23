import { expect, test } from 'bun:test';

import { parseCreateWorkspaceRequest } from '../../src/main/ipc/request-schemas.ts';

const GITHUB_LINKED_ISSUE = {
	id: 'https://github.com/o/r/issues/44',
	identifier: '#44',
	provider: 'github',
	title: 'Dedup recents',
	url: 'https://github.com/o/r/issues/44',
} as const;

const LINEAR_LINKED_ISSUE = {
	id: 'issue-uuid',
	identifier: 'THE-1',
	provider: 'linear',
	teamKey: 'THE',
	teamName: 'Theseus',
	title: 'Wire the picker',
	url: 'https://linear.app/the/issue/THE-1',
} as const;

// Regression: a GitHub-issue create sends `provider: 'github'`. The schema once
// pinned `provider` to `z.literal('linear')`, so the whole payload failed
// validation and `parseCreateWorkspaceRequest` fell back to `{ repositoryId: '' }`
// — surfacing as "A repository id is required" with nothing created.
test('accepts a GitHub-provider linked issue and keeps the repository id', () => {
	const parsed = parseCreateWorkspaceRequest({
		linkedIssue: GITHUB_LINKED_ISSUE,
		name: '#44 Dedup recents',
		repositoryId: 'repo-1',
	});

	expect(parsed.repositoryId).toBe('repo-1');
	expect(parsed.linkedIssue?.provider).toBe('github');
});

test('accepts a Linear-provider linked issue and keeps the repository id', () => {
	const parsed = parseCreateWorkspaceRequest({
		linkedIssue: LINEAR_LINKED_ISSUE,
		name: 'THE-1 Wire the picker',
		repositoryId: 'repo-1',
	});

	expect(parsed.repositoryId).toBe('repo-1');
	expect(parsed.linkedIssue?.provider).toBe('linear');
	expect(parsed.linkedIssue?.teamKey).toBe('THE');
});

test('falls back to an empty repository id when the provider is unknown', () => {
	const parsed = parseCreateWorkspaceRequest({
		linkedIssue: { ...GITHUB_LINKED_ISSUE, provider: 'jira' },
		repositoryId: 'repo-1',
	});

	expect(parsed.repositoryId).toBe('');
});
