import { expect, test } from 'vitest';

import {
	githubIssueSourceId,
	mapGithubIssuesToWorkspaceSources,
} from '../../src/renderer/lib/github/issue-view.ts';
import {
	branchSourceId,
	mapPullRequestsToWorkspaceSources,
	mapRepositoryBranchesToWorkspaceSources,
	pullRequestSourceId,
	workspaceSeedFromSourceItem,
} from '../../src/renderer/lib/workbench/workspace-source-mappers.ts';
import type {
	RepositoryBranchWire,
	RepositoryIssueWire,
	RepositoryPullRequestWire,
} from '../../src/shared/ipc/contracts/workspace-sources.ts';

function branch(
	over: Partial<RepositoryBranchWire> = {},
): RepositoryBranchWire {
	return {
		hasWorkspace: false,
		isDefault: false,
		name: 'psoldunov/feature-x',
		workspaceId: null,
		...over,
	};
}

function pullRequest(
	over: Partial<RepositoryPullRequestWire> = {},
): RepositoryPullRequestWire {
	return {
		authorLogin: 'octocat',
		headRefName: 'feature-x',
		isCrossRepository: false,
		isDraft: false,
		number: 30,
		state: 'OPEN',
		title: 'Add the picker',
		updatedAt: '',
		url: 'https://github.com/o/r/pull/30',
		...over,
	};
}

function githubIssue(
	over: Partial<RepositoryIssueWire> = {},
): RepositoryIssueWire {
	return {
		authorLogin: 'octocat',
		body: 'Repro steps',
		labels: ['bug'],
		number: 44,
		state: 'OPEN',
		title: 'Dedup recents',
		updatedAt: '',
		url: 'https://github.com/o/r/issues/44',
		...over,
	};
}

test('branch mapper uses the shared id and carries hasWorkspace', () => {
	const [source] = mapRepositoryBranchesToWorkspaceSources([
		branch({ hasWorkspace: true, name: 'master', workspaceId: 'ws-1' }),
	]);

	expect(source?.id).toBe(branchSourceId('master'));
	expect(source?.kind).toBe('branch');
	expect(source?.provider).toBe('github');
	expect(source?.hasWorkspace).toBe(true);
});

test('pull-request mapper uses the shared id and shows the head ref', () => {
	const [source] = mapPullRequestsToWorkspaceSources([pullRequest()]);

	expect(source?.id).toBe(pullRequestSourceId(30));
	expect(source?.reference).toBe('#30');
	expect(source?.subtitle).toBe('feature-x');
});

test('github-issue mapper uses the shared id and lowercases the state', () => {
	const [source] = mapGithubIssuesToWorkspaceSources([githubIssue()]);

	expect(source?.id).toBe(githubIssueSourceId(44));
	expect(source?.kind).toBe('issue');
	expect(source?.reference).toBe('#44');
	expect(source?.subtitle).toBe('open');
});

test('branch seed forks off origin/<name>, including nested names', () => {
	const seed = workspaceSeedFromSourceItem({
		branch: branch({ name: 'feat/nested/x' }),
		kind: 'branch',
	});

	expect(seed.baseBranch).toBe('origin/feat/nested/x');
	expect(seed.linkedIssue).toBeUndefined();
	expect(seed.branchName).toBeUndefined();
});

test('pull-request seed forks off origin/<headRefName>', () => {
	const seed = workspaceSeedFromSourceItem({
		kind: 'pull-request',
		pullRequest: pullRequest({ headRefName: 'fix-y' }),
	});

	expect(seed.baseBranch).toBe('origin/fix-y');
	expect(seed.linkedIssue).toBeUndefined();
});

test('github-issue seed attaches the linked issue and never sets a baseBranch', () => {
	const seed = workspaceSeedFromSourceItem({
		issue: githubIssue(),
		kind: 'github-issue',
	});

	expect(seed.baseBranch).toBeUndefined();
	expect(seed.linkedIssue?.provider).toBe('github');
	expect(seed.linkedIssue?.identifier).toBe('#44');
	expect(seed.linkedIssue?.description).toBe('Repro steps');
});
