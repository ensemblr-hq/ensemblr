import { expect, test } from 'bun:test';

import { mapRepositoriesToProjects } from '../../src/renderer/lib/workbench/navigation-model';
import type {
	RepositoryWorkspaceNavigationRepository,
	RepositoryWorkspaceNavigationWorkspace,
} from '../../src/shared/ipc';

function createWorkspaceRow(
	metadata: Record<string, unknown>,
): RepositoryWorkspaceNavigationWorkspace {
	return {
		archivedAt: null,
		baseBranch: 'main',
		branchName: 'feat/the-143-linear-oauth',
		createdAt: '2026-06-11T12:00:00.000Z',
		id: 'workspace-1',
		metadata,
		name: 'THE-143 Linear OAuth',
		path: '/tmp/workspaces/the-143',
		repositoryId: 'repository-1',
		slug: 'the-143-linear-oauth',
		updatedAt: '2026-06-11T12:00:00.000Z',
	};
}

function createRepositoryRow(
	workspace: RepositoryWorkspaceNavigationWorkspace,
): RepositoryWorkspaceNavigationRepository {
	return {
		createdAt: '2026-06-11T12:00:00.000Z',
		defaultBranch: 'main',
		id: 'repository-1',
		metadata: {},
		name: 'demo',
		path: '/tmp/repos/demo',
		slug: 'demo',
		updatedAt: '2026-06-11T12:00:00.000Z',
		workspaces: [workspace],
	};
}

const LINKED_ISSUE_METADATA = {
	id: 'issue-1',
	identifier: 'THE-143',
	provider: 'linear',
	teamKey: 'THE',
	teamName: 'Theseus',
	title: 'Linear OAuth PKCE and Token Lifecycle',
	url: 'https://linear.app/acme/issue/THE-143',
};

test('landing summary maps linked-issue metadata to the linked-issue kind', () => {
	const projects = mapRepositoriesToProjects([
		createRepositoryRow(
			createWorkspaceRow({ linkedIssue: LINKED_ISSUE_METADATA }),
		),
	]);

	const landing = projects[0]?.workspaces[0]?.landingSummary;
	expect(landing?.kind).toBe('linked-issue');
	expect(landing?.headline).toBe('Workspace created from THE-143');
	expect(landing?.linkedIssue).toEqual({
		provider: 'linear',
		reference: 'THE-143',
		remoteId: 'issue-1',
		subtitle: 'Theseus',
		title: 'Linear OAuth PKCE and Token Lifecycle',
		url: 'https://linear.app/acme/issue/THE-143',
	});
});

test('landing summary ignores malformed linked-issue metadata', () => {
	const projects = mapRepositoriesToProjects([
		createRepositoryRow(
			createWorkspaceRow({ linkedIssue: { provider: 'jira', title: 42 } }),
		),
	]);

	const landing = projects[0]?.workspaces[0]?.landingSummary;
	expect(landing?.kind).not.toBe('linked-issue');
	expect(landing?.linkedIssue).toBeUndefined();
});

test('landing summary stays branch-derived without linked metadata', () => {
	const projects = mapRepositoriesToProjects([
		createRepositoryRow(createWorkspaceRow({})),
	]);

	const landing = projects[0]?.workspaces[0]?.landingSummary;
	expect(landing?.kind).toBe('local-branch');
	expect(landing?.linkedIssue).toBeUndefined();
});
