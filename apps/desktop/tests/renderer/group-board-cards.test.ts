import { describe, expect, test } from 'vitest';

import { groupBoardCards } from '../../src/renderer/lib/workbench/group-board-cards';
import type { ProjectShellModel } from '../../src/renderer/types/workbench';
import type { BoardIssueCard } from '../../src/renderer/types/workbench-shell';

const issue = (key: string): BoardIssueCard =>
	({ key, provider: 'linear', reference: key }) as unknown as BoardIssueCard;

const project = (
	id: string,
	workspaces: { id: string; isPendingCreation?: boolean }[],
): ProjectShellModel => ({ id, name: id, workspaces }) as ProjectShellModel;

describe('groupBoardCards', () => {
	test('puts backlog issues in Backlog and nothing else', () => {
		const columns = groupBoardCards({
			backlogIssues: [issue('a'), issue('b')],
			dismissedIssues: [],
			order: [],
			projects: [],
			statusByWorkspaceId: {},
		});

		expect(columns.backlog).toEqual([
			{ issue: issue('a'), kind: 'issue' },
			{ issue: issue('b'), kind: 'issue' },
		]);
		expect(columns.canceled).toEqual([]);
		expect(columns['in-progress']).toEqual([]);
	});

	// The blocker in `use-board-drag.ts` was that a drop handler inferred Backlog
	// from a card being an issue. This is the invariant that makes that wrong.
	test('puts dismissed issues in Canceled, not Backlog', () => {
		const columns = groupBoardCards({
			backlogIssues: [issue('live')],
			dismissedIssues: [issue('dead')],
			order: [],
			projects: [],
			statusByWorkspaceId: {},
		});

		expect(columns.backlog).toEqual([{ issue: issue('live'), kind: 'issue' }]);
		expect(columns.canceled).toEqual([{ issue: issue('dead'), kind: 'issue' }]);
	});

	test('dismissed issues trail the workspaces already in Canceled', () => {
		const columns = groupBoardCards({
			backlogIssues: [],
			dismissedIssues: [issue('dead')],
			order: [],
			projects: [project('p', [{ id: 'w1' }])],
			statusByWorkspaceId: { w1: 'canceled' },
		});

		expect(columns.canceled.map((card) => card.kind)).toEqual([
			'workspace',
			'issue',
		]);
	});

	test('sorts a column by the persisted board order', () => {
		const columns = groupBoardCards({
			backlogIssues: [],
			dismissedIssues: [],
			order: ['w3', 'w1', 'w2'],
			projects: [project('p', [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }])],
			statusByWorkspaceId: { w1: 'done', w2: 'done', w3: 'done' },
		});

		expect(
			columns.done.map((card) =>
				card.kind === 'workspace' ? card.workspace.id : null,
			),
		).toEqual(['w3', 'w1', 'w2']);
	});

	test('puts a workspace missing from the order last, keeping the rest', () => {
		const columns = groupBoardCards({
			backlogIssues: [],
			dismissedIssues: [],
			order: ['w2'],
			projects: [project('p', [{ id: 'w1' }, { id: 'w2' }])],
			statusByWorkspaceId: { w1: 'done', w2: 'done' },
		});

		expect(
			columns.done.map((card) =>
				card.kind === 'workspace' ? card.workspace.id : null,
			),
		).toEqual(['w2', 'w1']);
	});

	test('skips workspaces the create call has not confirmed yet', () => {
		const columns = groupBoardCards({
			backlogIssues: [],
			dismissedIssues: [],
			order: [],
			projects: [
				project('p', [{ id: 'w1' }, { id: 'w2', isPendingCreation: true }]),
			],
			statusByWorkspaceId: { w1: 'done', w2: 'done' },
		});

		expect(columns.done).toHaveLength(1);
	});

	test('does not mutate the persisted order it is handed', () => {
		const order = ['w2', 'w1'];
		groupBoardCards({
			backlogIssues: [],
			dismissedIssues: [],
			order,
			projects: [project('p', [{ id: 'w1' }, { id: 'w2' }])],
			statusByWorkspaceId: { w1: 'done', w2: 'done' },
		});

		expect(order).toEqual(['w2', 'w1']);
	});

	test('returns a list for every board status', () => {
		const columns = groupBoardCards({
			backlogIssues: [],
			dismissedIssues: [],
			order: [],
			projects: [],
			statusByWorkspaceId: {},
		});

		for (const cards of Object.values(columns)) {
			expect(Array.isArray(cards)).toBe(true);
		}
	});
});
