import { expect, test } from 'vitest';

import {
	launchAgentHarnessRequestSchema,
	openChatTabRequestSchema,
	parseCreateWorkspaceRequest,
	parseGithubRepositoryListRequest,
	parseUpdateRepositorySettingsRequest,
	resumeAgentHarnessRequestSchema,
} from '../../src/main/ipc/request-schemas.ts';

test('openChatTabRequestSchema accepts the terminal tab kind', () => {
	const parsed = openChatTabRequestSchema.parse({
		kind: 'terminal',
		metadata: { harnessId: 'claude', terminalId: 't-1' },
		workspaceId: 'ws-1',
	});
	expect(parsed.kind).toBe('terminal');
});

test('launchAgentHarnessRequestSchema requires a harness id and workspace id', () => {
	expect(
		launchAgentHarnessRequestSchema.parse({
			harnessId: 'claude',
			workspaceId: 'ws-1',
		}),
	).toEqual({ harnessId: 'claude', workspaceId: 'ws-1' });
	expect(() =>
		launchAgentHarnessRequestSchema.parse({
			harnessId: '',
			workspaceId: 'ws-1',
		}),
	).toThrow();
});

test('resumeAgentHarnessRequestSchema requires chat tab, harness, and workspace ids', () => {
	expect(
		resumeAgentHarnessRequestSchema.parse({
			chatTabId: 'tab-1',
			harnessId: 'codex',
			workspaceId: 'ws-1',
		}),
	).toEqual({ chatTabId: 'tab-1', harnessId: 'codex', workspaceId: 'ws-1' });
	expect(() =>
		resumeAgentHarnessRequestSchema.parse({
			chatTabId: '',
			harnessId: 'codex',
			workspaceId: 'ws-1',
		}),
	).toThrow();
});

test('resumeAgentHarnessRequestSchema carries the fresh respawn flag', () => {
	expect(
		resumeAgentHarnessRequestSchema.parse({
			chatTabId: 'tab-1',
			fresh: true,
			harnessId: 'codex',
			workspaceId: 'ws-1',
		}).fresh,
	).toBe(true);
});

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

test('github repository list request defaults to recent scope when undefined', () => {
	expect(parseGithubRepositoryListRequest(undefined).scope).toBe('recent');
});

test('github repository list request defaults to recent scope for an empty object', () => {
	expect(parseGithubRepositoryListRequest({}).scope).toBe('recent');
});

test('github repository list request accepts an explicit full scope', () => {
	expect(parseGithubRepositoryListRequest({ scope: 'full' }).scope).toBe(
		'full',
	);
});

test('github repository list request falls back to recent scope for garbage input', () => {
	expect(parseGithubRepositoryListRequest({ scope: 'nonsense' }).scope).toBe(
		'recent',
	);
	expect(parseGithubRepositoryListRequest('garbage').scope).toBe('recent');
	expect(parseGithubRepositoryListRequest(null).scope).toBe('recent');
});

test('accepts a repository-settings patch and preserves explicit nulls', () => {
	const parsed = parseUpdateRepositorySettingsRequest({
		repositoryId: 'repo-1',
		settings: {
			archiveAfterMerge: null,
			branchFrom: 'develop',
			filesToCopy: ['.env'],
			previewUrls: [{ name: 'Dev', url: 'http://localhost:3000' }],
		},
	});

	expect(parsed).toEqual({
		repositoryId: 'repo-1',
		settings: {
			archiveAfterMerge: null,
			branchFrom: 'develop',
			filesToCopy: ['.env'],
			previewUrls: [{ name: 'Dev', url: 'http://localhost:3000' }],
		},
	});
});

test('rejects a repository-settings patch with a missing repository id', () => {
	expect(
		parseUpdateRepositorySettingsRequest({ repositoryId: '', settings: {} }),
	).toBeNull();
	expect(parseUpdateRepositorySettingsRequest('garbage')).toBeNull();
});
