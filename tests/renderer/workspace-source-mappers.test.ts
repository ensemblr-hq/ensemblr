import { expect, test } from 'vitest';

import {
	githubIssueSourceId,
	mapGithubIssuesToWorkspaceSources,
} from '../../src/renderer/lib/github/issue-view.ts';
import {
	branchSourceId,
	mapPullRequestsToWorkspaceSources,
	mapRepositoryBranchesToWorkspaceSources,
	openableWorkspaceId,
	pullRequestSourceId,
	workspaceSeedFromSourceItem,
} from '../../src/renderer/lib/workbench/workspace-source-mappers.ts';
import { getWorkspaceSourceActions } from '../../src/renderer/lib/workbench/workspace-sources.ts';
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
		baseRefName: 'master',
		hasWorkspace: false,
		headRefName: 'feature-x',
		isCrossRepository: false,
		isDraft: false,
		number: 30,
		state: 'OPEN',
		title: 'Add the picker',
		updatedAt: '',
		url: 'https://github.com/o/r/pull/30',
		workspaceId: null,
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
	expect(source?.hasWorkspace).toBe(false);
});

// Without this the picker offers Create for a head an active workspace already
// holds, and creation fails with `branch-already-checked-out` instead.
test('pull-request mapper carries workspace ownership through to the row', () => {
	const [source] = mapPullRequestsToWorkspaceSources([
		pullRequest({ hasWorkspace: true, workspaceId: 'ws-1' }),
	]);

	expect(source?.hasWorkspace).toBe(true);
});

test('github-issue mapper uses the shared id and lowercases the state', () => {
	const [source] = mapGithubIssuesToWorkspaceSources([githubIssue()]);

	expect(source?.id).toBe(githubIssueSourceId(44));
	expect(source?.kind).toBe('issue');
	expect(source?.reference).toBe('#44');
	expect(source?.subtitle).toBe('open');
});

test('use-branch seed adopts the branch and leaves the base to the service', () => {
	const seed = workspaceSeedFromSourceItem(
		{ branch: branch({ name: 'feat/nested/x' }), kind: 'branch' },
		'use-branch',
	);

	expect(seed.branchPlan).toEqual({ branch: 'feat/nested/x', kind: 'adopt' });
	expect(seed.name).toBe('feat/nested/x');
	expect(seed.baseBranch).toBeUndefined();
	expect(seed.linkedIssue).toBeUndefined();
	expect(seed.branchName).toBeUndefined();
});

test('duplicate-branch seed forks off origin/<name> instead of adopting', () => {
	const seed = workspaceSeedFromSourceItem(
		{ branch: branch({ name: 'feat/nested/x' }), kind: 'branch' },
		'duplicate-branch',
	);

	expect(seed.branchPlan).toEqual({
		forkRef: 'origin/feat/nested/x',
		kind: 'create',
	});
	expect(seed.baseBranch).toBeUndefined();
	expect(seed.name).toBeUndefined();
});

test('pull-request seed adopts the head and targets the PR base', () => {
	const seed = workspaceSeedFromSourceItem(
		{
			kind: 'pull-request',
			pullRequest: pullRequest({
				baseRefName: 'develop',
				headRefName: 'fix-y',
				title: 'Fix the y axis',
			}),
		},
		'create',
	);

	expect(seed.branchPlan).toEqual({ branch: 'fix-y', kind: 'adopt' });
	expect(seed.baseBranch).toBe('origin/develop');
	expect(seed.name).toBe('Fix the y axis');
	expect(seed.linkedIssue).toBeUndefined();
});

test('pull-request seed omits the base when the PR reports no base ref', () => {
	const seed = workspaceSeedFromSourceItem(
		{
			kind: 'pull-request',
			pullRequest: pullRequest({ baseRefName: '', headRefName: 'fix-y' }),
		},
		'create',
	);

	expect(seed.baseBranch).toBeUndefined();
	expect(seed.branchPlan).toEqual({ branch: 'fix-y', kind: 'adopt' });
});

test('github-issue seed attaches the linked issue and never sets a baseBranch', () => {
	const seed = workspaceSeedFromSourceItem(
		{ issue: githubIssue(), kind: 'github-issue' },
		'create',
	);

	expect(seed.baseBranch).toBeUndefined();
	expect(seed.linkedIssue?.provider).toBe('github');
	expect(seed.linkedIssue?.identifier).toBe('#44');
	expect(seed.linkedIssue?.description).toBe('Repro steps');
});

test('duplicating a pull request forks the head and keeps the PR base', () => {
	const seed = workspaceSeedFromSourceItem(
		{
			kind: 'pull-request',
			pullRequest: pullRequest({
				baseRefName: 'develop',
				headRefName: 'fix-y',
			}),
		},
		'duplicate-branch',
	);

	expect(seed.baseBranch).toBe('origin/develop');
	expect(seed.branchPlan).toEqual({
		forkRef: 'origin/fix-y',
		kind: 'create',
	});
	expect(seed.name).toBeUndefined();
});

test.each([
	[
		'branch',
		{ branch: branch({ workspaceId: 'ws-1' }), kind: 'branch' } as const,
	],
	[
		'pull request',
		{
			kind: 'pull-request',
			pullRequest: pullRequest({ hasWorkspace: true, workspaceId: 'ws-1' }),
		} as const,
	],
])('open on a %s row navigates to the holding workspace', (_label, item) => {
	expect(openableWorkspaceId(item, 'open')).toBe('ws-1');
});

test('every action other than open creates rather than navigates', () => {
	const item = {
		kind: 'pull-request',
		pullRequest: pullRequest({ hasWorkspace: true, workspaceId: 'ws-1' }),
	} as const;

	expect(openableWorkspaceId(item, 'create')).toBeNull();
	expect(openableWorkspaceId(item, 'duplicate-branch')).toBeNull();
});

test('an issue row never resolves to an existing workspace', () => {
	expect(
		openableWorkspaceId({ issue: githubIssue(), kind: 'github-issue' }, 'open'),
	).toBeNull();
});

// Git allows a branch in one worktree at a time, so a held head must offer Open
// rather than a Create that can only fail.
test('a pull request whose head is held offers open and duplicate', () => {
	const [held] = mapPullRequestsToWorkspaceSources([
		pullRequest({ hasWorkspace: true, workspaceId: 'ws-1' }),
	]);
	const [free] = mapPullRequestsToWorkspaceSources([pullRequest()]);
	if (!held || !free) {
		throw new Error('sources missing');
	}

	expect(getWorkspaceSourceActions(held).map((action) => action.id)).toEqual([
		'open',
		'duplicate-branch',
	]);
	expect(getWorkspaceSourceActions(free).map((action) => action.id)).toEqual([
		'create',
	]);
});
