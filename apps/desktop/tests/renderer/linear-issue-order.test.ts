import { expect, test } from 'vitest';

import {
	isLinearIssueClosed,
	linearPriorityRank,
	orderLinearIssues,
	resolveLinearStateBucket,
} from '../../src/renderer/lib/linear';
import { createLinearIssueFixture } from '../fixtures/linear';

const urgent = createLinearIssueFixture({
	id: 'urgent',
	identifier: 'ENG-1',
	priority: 1,
	stateType: 'started',
	title: 'Broken login',
	updatedAt: '2026-06-01T00:00:00.000Z',
});

const none = createLinearIssueFixture({
	assigneeId: null,
	assigneeName: null,
	id: 'none',
	identifier: 'ENG-2',
	priority: 0,
	stateType: 'backlog',
	title: 'Alphabetically first',
	updatedAt: '2026-06-09T00:00:00.000Z',
});

const low = createLinearIssueFixture({
	id: 'low',
	identifier: 'ENG-3',
	priority: 4,
	stateType: 'unstarted',
	title: 'Zebra striping',
	updatedAt: '2026-06-10T00:00:00.000Z',
});

const done = createLinearIssueFixture({
	id: 'done',
	identifier: 'ENG-4',
	priority: 2,
	stateType: 'completed',
	title: 'Shipped already',
	updatedAt: '2026-06-11T00:00:00.000Z',
});

const canceled = createLinearIssueFixture({
	id: 'canceled',
	identifier: 'ENG-5',
	priority: null,
	stateType: 'canceled',
	title: 'Dropped',
	updatedAt: '2026-06-12T00:00:00.000Z',
});

const ALL = [urgent, none, low, done, canceled];

/** Flattens a board into the issue ids it renders, in render order. */
function idsOf(issues: readonly { id: string }[]): string[] {
	return issues.map((issue) => issue.id);
}

test('resolveLinearStateBucket: maps every Linear state type, unknown included', () => {
	expect(resolveLinearStateBucket({ stateType: 'triage' })).toBe('triage');
	expect(resolveLinearStateBucket({ stateType: 'backlog' })).toBe('backlog');
	expect(resolveLinearStateBucket({ stateType: 'started' })).toBe('started');
	expect(resolveLinearStateBucket({ stateType: 'completed' })).toBe(
		'completed',
	);
	expect(resolveLinearStateBucket({ stateType: 'canceled' })).toBe('canceled');
	expect(resolveLinearStateBucket({ stateType: null })).toBe('unstarted');
	expect(resolveLinearStateBucket({ stateType: 'invented' })).toBe('unstarted');
});

test('isLinearIssueClosed: only done and canceled count as closed', () => {
	expect(isLinearIssueClosed(done)).toBe(true);
	expect(isLinearIssueClosed(canceled)).toBe(true);
	expect(isLinearIssueClosed(urgent)).toBe(false);
	expect(isLinearIssueClosed(none)).toBe(false);
});

test('linearPriorityRank: urgent leads and "no priority" sorts last', () => {
	expect(
		[4, 0, 1, null, 2].sort(
			(a, b) => linearPriorityRank(a) - linearPriorityRank(b),
		),
	).toEqual([1, 2, 4, 0, null]);
});

test('orderLinearIssues: the active scope hides done and canceled work', () => {
	const board = orderLinearIssues({
		grouping: 'none',
		issues: ALL,
		scope: 'active',
		sort: 'priority',
	});

	expect(board.total).toBe(3);
	expect(idsOf(board.groups[0]?.issues ?? [])).toEqual([
		'urgent',
		'low',
		'none',
	]);
});

test('orderLinearIssues: the closed scope keeps only done and canceled work', () => {
	const board = orderLinearIssues({
		grouping: 'none',
		issues: ALL,
		scope: 'closed',
		sort: 'priority',
	});

	expect(idsOf(board.groups[0]?.issues ?? [])).toEqual(['done', 'canceled']);
});

test('orderLinearIssues: ungrouped boards render one unlabelled section', () => {
	const board = orderLinearIssues({
		grouping: 'none',
		issues: ALL,
		scope: 'all',
		sort: 'updated',
	});

	expect(board.groups).toHaveLength(1);
	expect(board.groups[0]?.label).toBeNull();
	expect(idsOf(board.groups[0]?.issues ?? [])).toEqual([
		'canceled',
		'done',
		'low',
		'none',
		'urgent',
	]);
});

test('orderLinearIssues: sorting by title is alphabetical, by status is live work first', () => {
	const byTitle = orderLinearIssues({
		grouping: 'none',
		issues: ALL,
		scope: 'all',
		sort: 'title',
	});
	expect(idsOf(byTitle.groups[0]?.issues ?? [])).toEqual([
		'none',
		'urgent',
		'canceled',
		'done',
		'low',
	]);

	const byStatus = orderLinearIssues({
		grouping: 'none',
		issues: ALL,
		scope: 'all',
		sort: 'status',
	});
	expect(idsOf(byStatus.groups[0]?.issues ?? [])).toEqual([
		'urgent',
		'low',
		'none',
		'done',
		'canceled',
	]);
});

test('orderLinearIssues: status groups follow tracker order and drop empty buckets', () => {
	const board = orderLinearIssues({
		grouping: 'status',
		issues: ALL,
		scope: 'all',
		sort: 'priority',
	});

	expect(board.groups.map((group) => group.id)).toEqual([
		'started',
		'unstarted',
		'backlog',
		'completed',
		'canceled',
	]);
	expect(board.groups.every((group) => group.issues.length > 0)).toBe(true);
	expect(board.groups[0]?.stateBucket).toBe('started');
});

test('orderLinearIssues: priority groups run urgent first with "no priority" last', () => {
	const board = orderLinearIssues({
		grouping: 'priority',
		issues: ALL,
		scope: 'all',
		sort: 'updated',
	});

	expect(board.groups.map((group) => group.priority)).toEqual([1, 2, 4, 0]);
	expect(idsOf(board.groups.at(-1)?.issues ?? [])).toEqual([
		'canceled',
		'none',
	]);
});

test('orderLinearIssues: assignee groups pin unassigned work to the end', () => {
	const board = orderLinearIssues({
		grouping: 'assignee',
		issues: ALL,
		scope: 'all',
		sort: 'priority',
	});

	expect(board.groups.map((group) => group.id)).toEqual([
		'user-1',
		'unassigned',
	]);
	expect(idsOf(board.groups.at(-1)?.issues ?? [])).toEqual(['none']);
});

test('orderLinearIssues: an unparseable updatedAt sorts last instead of throwing', () => {
	const broken = createLinearIssueFixture({
		id: 'broken',
		identifier: 'ENG-9',
		priority: 2,
		updatedAt: 'not-a-date',
	});
	const board = orderLinearIssues({
		grouping: 'none',
		issues: [broken, done],
		scope: 'all',
		sort: 'updated',
	});

	expect(idsOf(board.groups[0]?.issues ?? [])).toEqual(['done', 'broken']);
});
