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
	// The plan keeps the real branch; only the display name is sanitized.
	expect(seed.name).toBe('feat nested x');
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
		'use-branch',
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
		'use-branch',
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

// Git allows a branch in one worktree at a time and the repository folder
// already holds the default branch, so adopting it could only ever fail.
test('the default branch forks instead of adopting', () => {
	const seed = workspaceSeedFromSourceItem(
		{ branch: branch({ isDefault: true, name: 'master' }), kind: 'branch' },
		'create',
	);

	expect(seed.branchPlan).toEqual({ forkRef: 'origin/master', kind: 'create' });
	expect(seed.baseBranch).toBe('origin/master');
	// No name: a fresh branch off master gets the generated placeholder, the
	// same as every other new workspace.
	expect(seed.name).toBeUndefined();
});

test('a non-default branch still adopts', () => {
	const seed = workspaceSeedFromSourceItem(
		{ branch: branch({ isDefault: false, name: 'feature-x' }), kind: 'branch' },
		'use-branch',
	);

	expect(seed.branchPlan).toEqual({ branch: 'feature-x', kind: 'adopt' });
});

test('the default branch row offers Create, not Use branch', () => {
	const [defaultRow] = mapRepositoryBranchesToWorkspaceSources([
		branch({ isDefault: true, name: 'master' }),
	]);
	const [featureRow] = mapRepositoryBranchesToWorkspaceSources([
		branch({ isDefault: false, name: 'feature-x' }),
	]);
	if (!defaultRow || !featureRow) {
		throw new Error('sources missing');
	}

	expect(
		getWorkspaceSourceActions(defaultRow).map((action) => action.id),
	).toEqual(['create']);
	expect(
		getWorkspaceSourceActions(featureRow).map((action) => action.id),
	).toEqual(['use-branch']);
});

// The service rejects a name outside `[A-Za-z0-9 ._-]`, so a seed that passes a
// raw branch name or PR title through fails creation with `name-invalid`.
test('a slashed branch name is sanitized into a usable workspace name', () => {
	const seed = workspaceSeedFromSourceItem(
		{ branch: branch({ name: 'psoldunov/feat/nested-x' }), kind: 'branch' },
		'use-branch',
	);

	expect(seed.name).toBe('psoldunov feat nested-x');
	expect(seed.branchPlan).toEqual({
		branch: 'psoldunov/feat/nested-x',
		kind: 'adopt',
	});
});

test('a punctuated pull-request title is sanitized into a usable name', () => {
	const seed = workspaceSeedFromSourceItem(
		{
			kind: 'pull-request',
			pullRequest: pullRequest({
				headRefName: 'fix-y',
				title: 'fix(review): stop diffing a branch against itself',
			}),
		},
		'use-branch',
	);

	expect(seed.name).toBe('fix review stop diffing a branch against itself');
	expect(seed.branchPlan).toEqual({ branch: 'fix-y', kind: 'adopt' });
});

test('a source whose label sanitizes to nothing falls back to a placeholder', () => {
	const branchSeed = workspaceSeedFromSourceItem(
		{ branch: branch({ name: '///' }), kind: 'branch' },
		'use-branch',
	);
	const prSeed = workspaceSeedFromSourceItem(
		{ kind: 'pull-request', pullRequest: pullRequest({ title: '🚀' }) },
		'use-branch',
	);

	expect(branchSeed.name).toBeUndefined();
	expect(prSeed.name).toBeUndefined();
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
		'use-branch',
	]);
});

// The row takes the head branch over, so it must not be labelled with a promise
// to cut a new one.
test('a free pull-request row offers the same take-over action as a branch', () => {
	const [pullRequestRow] = mapPullRequestsToWorkspaceSources([pullRequest()]);
	const [branchRow] = mapRepositoryBranchesToWorkspaceSources([branch()]);
	if (!pullRequestRow || !branchRow) {
		throw new Error('sources missing');
	}

	expect(getWorkspaceSourceActions(pullRequestRow)).toEqual(
		getWorkspaceSourceActions(branchRow),
	);
	expect(getWorkspaceSourceActions(pullRequestRow)[0]?.label).toBe(
		'Use branch',
	);
});
