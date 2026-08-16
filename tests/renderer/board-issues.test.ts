import { describe, expect, test } from 'vitest';

import { collectBacklogIssues } from '../../src/renderer/lib/workbench/board-issues';
import type { LinearIssueWire } from '../../src/shared/ipc/contracts/linear';
import type { RepositoryIssueWire } from '../../src/shared/ipc/contracts/workspace-sources';

function linearIssue(
	overrides: Partial<LinearIssueWire> = {},
): LinearIssueWire {
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
		labels: [{ color: null, id: 'l1', name: 'bug' }],
		organizationName: 'Ensemblr',
		priority: 2,
		projectId: null,
		projectName: null,
		stateColor: '#fff',
		stateId: 's1',
		stateName: 'Todo',
		stateType: 'unstarted',
		syncedAt: null,
		teamId: 't1',
		teamKey: 'ENS',
		teamName: 'Ensemblr',
		title: 'Wire the board',
		updatedAt: '2026-08-14T10:00:00.000Z',
		url: 'https://linear.app/e/issue/ENS-1',
		...overrides,
	};
}

function githubIssue(
	overrides: Partial<RepositoryIssueWire> = {},
): RepositoryIssueWire {
	return {
		assigneeLogins: [],
		authorLogin: 'octocat',
		body: '',
		labels: ['bug'],
		number: 42,
		state: 'OPEN',
		title: 'Paste loses the file',
		updatedAt: '2026-08-13T10:00:00.000Z',
		url: 'https://github.com/o/r/issues/42',
		...overrides,
	};
}

function collect({
	dismissedKeys = [],
	githubIssues = [],
	linearIssues = [],
	linkedIssueKeys = [],
}: {
	dismissedKeys?: string[];
	githubIssues?: RepositoryIssueWire[];
	linearIssues?: LinearIssueWire[];
	linkedIssueKeys?: string[];
} = {}) {
	return collectBacklogIssues({
		dismissedKeys,
		githubIssuesByProject: [
			{ issues: githubIssues, projectId: 'repo-1', projectName: 'copland' },
		],
		linearIssues,
		linkedIssueKeys,
	});
}

describe('collectBacklogIssues Linear state filter', () => {
	test('keeps backlog and unstarted issues', () => {
		const result = collect({
			linearIssues: [
				linearIssue({ id: 'a', stateType: 'backlog' }),
				linearIssue({ id: 'b', stateType: 'unstarted' }),
			],
		});
		expect(result.backlog.map((card) => card.key)).toEqual(['a', 'b']);
	});

	test('drops started, completed, and canceled issues', () => {
		const result = collect({
			linearIssues: [
				linearIssue({ id: 'a', stateType: 'started' }),
				linearIssue({ id: 'b', stateType: 'completed' }),
				linearIssue({ id: 'c', stateType: 'canceled' }),
				linearIssue({ id: 'd', stateType: null }),
			],
		});
		expect(result.backlog).toEqual([]);
	});

	test('drops archived issues even when unstarted', () => {
		const result = collect({
			linearIssues: [linearIssue({ archivedAt: '2026-08-01T00:00:00.000Z' })],
		});
		expect(result.backlog).toEqual([]);
	});

	test('normalizes the card off the Linear fields', () => {
		const [card] = collect({ linearIssues: [linearIssue()] }).backlog;
		expect(card).toMatchObject({
			key: 'linear-1',
			labels: ['bug'],
			priority: 2,
			projectId: null,
			provider: 'linear',
			reference: 'ENS-1',
			stateName: 'Todo',
			subtitle: 'Ensemblr',
			title: 'Wire the board',
		});
		expect(card?.item).toMatchObject({ kind: 'linear-issue' });
	});
});

describe('collectBacklogIssues GitHub unassigned filter', () => {
	test('keeps open issues with no assignee', () => {
		const result = collect({ githubIssues: [githubIssue()] });
		expect(result.backlog.map((card) => card.reference)).toEqual(['#42']);
	});

	test('drops issues someone is already on', () => {
		const result = collect({
			githubIssues: [githubIssue({ assigneeLogins: ['octocat'] })],
		});
		expect(result.backlog).toEqual([]);
	});

	test('drops closed issues', () => {
		const result = collect({
			githubIssues: [githubIssue({ state: 'CLOSED' })],
		});
		expect(result.backlog).toEqual([]);
	});

	test('keys a GitHub issue by its URL and carries its repository', () => {
		const [card] = collect({ githubIssues: [githubIssue()] }).backlog;
		expect(card).toMatchObject({
			key: 'https://github.com/o/r/issues/42',
			priority: null,
			projectId: 'repo-1',
			provider: 'github',
			subtitle: 'copland',
		});
	});
});

describe('collectBacklogIssues subtraction', () => {
	test('drops an issue that already produced a workspace', () => {
		const result = collect({
			githubIssues: [githubIssue()],
			linearIssues: [linearIssue()],
			linkedIssueKeys: ['linear-1', 'https://github.com/o/r/issues/42'],
		});
		expect(result.backlog).toEqual([]);
		expect(result.dismissed).toEqual([]);
	});

	test('moves a dismissed issue out of backlog rather than dropping it', () => {
		const result = collect({
			dismissedKeys: ['linear-1'],
			linearIssues: [linearIssue(), linearIssue({ id: 'linear-2' })],
		});
		expect(result.backlog.map((card) => card.key)).toEqual(['linear-2']);
		expect(result.dismissed.map((card) => card.key)).toEqual(['linear-1']);
	});

	test('a linked issue stays off the board even when also dismissed', () => {
		const result = collect({
			dismissedKeys: ['linear-1'],
			linearIssues: [linearIssue()],
			linkedIssueKeys: ['linear-1'],
		});
		expect(result.backlog).toEqual([]);
		expect(result.dismissed).toEqual([]);
	});

	test('deduplicates issues that arrive twice under one key', () => {
		const result = collect({
			linearIssues: [linearIssue(), linearIssue()],
		});
		expect(result.backlog).toHaveLength(1);
	});
});
