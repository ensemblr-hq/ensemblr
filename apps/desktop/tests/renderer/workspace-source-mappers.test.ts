import { expect, test } from 'vitest';

import {
	githubIssueSourceId,
	mapGithubIssuesToWorkspaceSources,
} from '../../src/renderer/lib/github/issue-view.ts';
import {
	branchSourceId,
	collectLinkedIssueKeys,
	mapPullRequestsToWorkspaceSources,
	mapRepositoryBranchesToWorkspaceSources,
	mapStartableIssuesToWorkspaceSources,
	openableWorkspaceId,
	pullRequestSourceId,
	selectStartableIssues,
	selectStartedLinearIssues,
	workspaceSeedFromSourceItem,
} from '../../src/renderer/lib/workbench/workspace-source-mappers.ts';
import { getWorkspaceSourceActions } from '../../src/renderer/lib/workbench/workspace-sources.ts';
import type { ProjectShellModel } from '../../src/renderer/types/workbench';
import type { LinearIssueWire } from '../../src/shared/ipc/contracts/linear.ts';
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
		name: 'octocat/feature-x',
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
		assigneeLogins: [],
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
		{ branch: branch({ name: 'octocat/feat/nested-x' }), kind: 'branch' },
		'use-branch',
	);

	expect(seed.name).toBe('octocat feat nested-x');
	expect(seed.branchPlan).toEqual({
		branch: 'octocat/feat/nested-x',
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

function linearIssue(over: Partial<LinearIssueWire> = {}): LinearIssueWire {
	return {
		accountId: 'acc-1',
		archivedAt: null,
		assigneeId: null,
		assigneeName: null,
		cycleId: null,
		cycleName: null,
		description: null,
		dueDate: null,
		id: 'linear-1',
		identifier: 'ENS-1',
		labels: [],
		organizationName: 'Ensemblr',
		priority: 2,
		projectId: null,
		projectName: null,
		stateColor: null,
		stateId: 's1',
		stateName: 'Todo',
		stateType: 'unstarted',
		syncedAt: null,
		teamId: 't1',
		teamKey: 'ENS',
		teamName: 'Ensemblr',
		title: 'Wire the picker',
		updatedAt: null,
		url: 'https://linear.app/e/issue/ENS-1',
		...over,
	};
}

function projectLinkedTo(remoteIds: readonly (string | null)[]) {
	return {
		workspaces: remoteIds.map((remoteId) => ({
			landingSummary: remoteId ? { linkedIssue: { remoteId } } : undefined,
		})),
	} as unknown as ProjectShellModel;
}

test('the issue picker lists Linear issues in Backlog or Todo only', () => {
	const { linearIssues } = selectStartableIssues({
		githubIssues: [],
		linearIssues: [
			linearIssue({ id: 'backlog', stateType: 'backlog' }),
			linearIssue({ id: 'todo', stateType: 'unstarted' }),
			linearIssue({ id: 'triage', stateType: 'triage' }),
			linearIssue({ id: 'started', stateType: 'started' }),
			linearIssue({ id: 'done', stateType: 'completed' }),
			linearIssue({ id: 'canceled', stateType: 'canceled' }),
			linearIssue({ id: 'unknown', stateType: null }),
			linearIssue({
				archivedAt: '2026-09-01T00:00:00.000Z',
				id: 'archived',
				stateType: 'backlog',
			}),
		],
		linkedIssueKeys: [],
	});

	expect(linearIssues.map((issue) => issue.id)).toEqual(['backlog', 'todo']);
});

// A team renames its states freely, so "Ready" must match as a Todo state does.
test('the issue picker matches Linear states by type, not by name', () => {
	const { linearIssues } = selectStartableIssues({
		githubIssues: [],
		linearIssues: [
			linearIssue({ id: 'ready', stateName: 'Ready', stateType: 'unstarted' }),
			linearIssue({ id: 'todo', stateName: 'Todo', stateType: 'started' }),
		],
		linkedIssueKeys: [],
	});

	expect(linearIssues.map((issue) => issue.id)).toEqual(['ready']);
});

test('the issue picker hides issues that already produced a workspace', () => {
	const { githubIssues, linearIssues } = selectStartableIssues({
		githubIssues: [
			githubIssue({ number: 1, url: 'https://github.com/o/r/issues/1' }),
			githubIssue({ number: 2, url: 'https://github.com/o/r/issues/2' }),
		],
		linearIssues: [linearIssue({ id: 'a' }), linearIssue({ id: 'b' })],
		linkedIssueKeys: ['https://github.com/o/r/issues/1', 'b'],
	});

	expect(githubIssues.map((issue) => issue.number)).toEqual([2]);
	expect(linearIssues.map((issue) => issue.id)).toEqual(['a']);
});

test('the issue picker keeps open GitHub issues whoever they are assigned to', () => {
	const { githubIssues } = selectStartableIssues({
		githubIssues: [githubIssue({ assigneeLogins: ['octocat'] })],
		linearIssues: [],
		linkedIssueKeys: [],
	});

	expect(githubIssues).toHaveLength(1);
});

test('the issue picker puts urgent Linear issues ahead of stale backlog and GitHub rows', () => {
	const sources = mapStartableIssuesToWorkspaceSources({
		githubIssues: [
			githubIssue({ number: 1, updatedAt: '2026-09-30T00:00:00.000Z' }),
		],
		linearIssues: [
			linearIssue({
				id: 'backlog-low',
				priority: 4,
				stateType: 'backlog',
				updatedAt: '2026-09-01T00:00:00.000Z',
			}),
			linearIssue({
				id: 'todo-urgent',
				priority: 1,
				updatedAt: '2026-08-01T00:00:00.000Z',
			}),
			linearIssue({
				id: 'todo-high',
				priority: 2,
				updatedAt: '2026-09-02T00:00:00.000Z',
			}),
		],
	});

	expect(sources.map((source) => source.id)).toEqual([
		'todo-urgent',
		'todo-high',
		'backlog-low',
		githubIssueSourceId(1),
	]);
});

// GitHub has no priority, so its issues rank with Linear's unprioritized ones.
test('the issue picker interleaves GitHub issues with unprioritized Linear ones by last update', () => {
	const sources = mapStartableIssuesToWorkspaceSources({
		githubIssues: [
			githubIssue({ number: 1, updatedAt: '2026-09-01T00:00:00.000Z' }),
			githubIssue({ number: 2, updatedAt: '2026-09-20T00:00:00.000Z' }),
			githubIssue({ number: 3, updatedAt: '' }),
		],
		linearIssues: [
			linearIssue({
				id: 'none-mid',
				priority: 0,
				updatedAt: '2026-09-10T00:00:00.000Z',
			}),
			linearIssue({ id: 'none-undated', priority: 0, updatedAt: null }),
		],
	});

	expect(sources.map((source) => source.id)).toEqual([
		githubIssueSourceId(2),
		'none-mid',
		githubIssueSourceId(1),
		githubIssueSourceId(3),
		'none-undated',
	]);
});

test('the issue picker keeps each row mapped as its own provider renders it', () => {
	const sources = mapStartableIssuesToWorkspaceSources({
		githubIssues: [githubIssue({ number: 7, title: 'GitHub row' })],
		linearIssues: [
			linearIssue({
				id: 'linear-row',
				identifier: 'ENS-9',
				priority: 3,
				projectName: 'Desktop',
				title: 'Linear row',
			}),
		],
	});

	expect(sources).toEqual([
		expect.objectContaining({
			id: 'linear-row',
			provider: 'linear',
			reference: 'ENS-9',
			title: 'Linear row',
			trackerProject: 'Desktop',
		}),
		expect.objectContaining({
			id: githubIssueSourceId(7),
			provider: 'github',
			reference: '#7',
			title: 'GitHub row',
		}),
	]);
});

test('a picker search reaches Linear issues in a started state only', () => {
	const started = selectStartedLinearIssues({
		linearIssues: [
			linearIssue({ id: 'backlog', stateType: 'backlog' }),
			linearIssue({ id: 'todo', stateType: 'unstarted' }),
			linearIssue({ id: 'triage', stateType: 'triage' }),
			linearIssue({
				id: 'in-progress',
				stateName: 'In Progress',
				stateType: 'started',
			}),
			linearIssue({
				id: 'in-review',
				stateName: 'In Review',
				stateType: 'started',
			}),
			linearIssue({ id: 'done', stateType: 'completed' }),
			linearIssue({ id: 'canceled', stateType: 'canceled' }),
			linearIssue({ id: 'unknown', stateType: null }),
			linearIssue({
				archivedAt: '2026-09-01T00:00:00.000Z',
				id: 'archived',
				stateType: 'started',
			}),
		],
		linkedIssueKeys: [],
	});

	expect(started.map((issue) => issue.id)).toEqual([
		'in-progress',
		'in-review',
	]);
});

// A started issue may be started because a workspace here is already on it.
test('a picker search does not reach a started issue that produced a workspace', () => {
	const started = selectStartedLinearIssues({
		linearIssues: [
			linearIssue({ id: 'a', stateType: 'started' }),
			linearIssue({ id: 'b', stateType: 'started' }),
		],
		linkedIssueKeys: ['b'],
	});

	expect(started.map((issue) => issue.id)).toEqual(['a']);
});

test('started issues follow the startable order: priority, then last update', () => {
	const started = selectStartedLinearIssues({
		linearIssues: [
			linearIssue({
				id: 'low-recent',
				priority: 4,
				stateType: 'started',
				updatedAt: '2026-10-02T00:00:00.000Z',
			}),
			linearIssue({
				id: 'urgent-old',
				priority: 1,
				stateType: 'started',
				updatedAt: '2026-09-01T00:00:00.000Z',
			}),
			linearIssue({
				id: 'urgent-recent',
				priority: 1,
				stateType: 'started',
				updatedAt: '2026-10-01T00:00:00.000Z',
			}),
		],
		linkedIssueKeys: [],
	});

	expect(started.map((issue) => issue.id)).toEqual([
		'urgent-recent',
		'urgent-old',
		'low-recent',
	]);
});

test('linked-issue keys are collected across every project and skip unlinked workspaces', () => {
	expect(
		collectLinkedIssueKeys([
			projectLinkedTo(['linear-1', null]),
			projectLinkedTo(['https://github.com/o/r/issues/7']),
		]),
	).toEqual(['linear-1', 'https://github.com/o/r/issues/7']);
});
