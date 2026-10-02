import { describe, expect, test } from 'vitest';

import { planBoardDrop } from '../../src/renderer/lib/workbench/plan-board-drop';
import type { BoardDrop } from '../../src/renderer/types/workbench-shell';

const cardDrop = (overrides: Partial<BoardDrop> = {}): BoardDrop => ({
	edge: 'top',
	sourceId: 'a',
	sourceKind: 'workspace',
	targetCardId: 'b',
	targetCardKind: 'workspace',
	targetColumnStatus: null,
	...overrides,
});

const columnDrop = (overrides: Partial<BoardDrop> = {}): BoardDrop => ({
	edge: null,
	sourceId: 'a',
	sourceKind: 'workspace',
	targetCardId: null,
	targetCardKind: null,
	targetColumnStatus: 'in-review',
	...overrides,
});

describe('planBoardDrop', () => {
	test('takes the target card status for a card drop', () => {
		const plan = planBoardDrop(cardDrop(), { b: 'done' });
		expect(plan).toEqual({
			kind: 'move-workspace',
			placeAfter: false,
			sourceId: 'a',
			targetCardId: 'b',
			targetStatus: 'done',
		});
	});

	test('defaults the target status when the target card has none', () => {
		const plan = planBoardDrop(cardDrop(), {});
		expect(plan).toMatchObject({ targetStatus: 'in-progress' });
	});

	test('marks placeAfter when dropping on a card bottom edge', () => {
		const plan = planBoardDrop(cardDrop({ edge: 'bottom' }), { b: 'done' });
		expect(plan).toMatchObject({ placeAfter: true });
	});

	test('takes the column status when dropping on column whitespace', () => {
		const plan = planBoardDrop(columnDrop(), { a: 'done' });
		expect(plan).toEqual({
			kind: 'move-workspace',
			placeAfter: false,
			sourceId: 'a',
			targetCardId: null,
			targetStatus: 'in-review',
		});
	});

	test('returns null when dropping on the whitespace of the current column', () => {
		expect(planBoardDrop(columnDrop(), { a: 'in-review' })).toBeNull();
	});

	test('returns null when neither a card nor a column resolves', () => {
		expect(
			planBoardDrop(columnDrop({ targetColumnStatus: null }), {}),
		).toBeNull();
	});
});

describe('planBoardDrop under a non-manual sort', () => {
	const sameColumn = cardDrop({ sourceId: 'a', targetCardId: 'b' });

	test('honours a same-column reorder under the manual sort', () => {
		expect(
			planBoardDrop(sameColumn, { a: 'done', b: 'done' }, 'manual'),
		).toMatchObject({ kind: 'move-workspace', targetStatus: 'done' });
	});

	test('refuses a same-column reorder when sorted by update time', () => {
		expect(
			planBoardDrop(sameColumn, { a: 'done', b: 'done' }, 'updated'),
		).toBeNull();
	});

	test('refuses a same-column reorder when sorted by priority', () => {
		expect(
			planBoardDrop(sameColumn, { a: 'done', b: 'done' }, 'priority'),
		).toBeNull();
	});

	test('keeps cross-column drops working under every sort', () => {
		for (const sort of ['manual', 'updated', 'priority'] as const) {
			expect(
				planBoardDrop(sameColumn, { a: 'in-review', b: 'done' }, sort),
			).toMatchObject({ kind: 'move-workspace', targetStatus: 'done' });
			expect(planBoardDrop(columnDrop(), { a: 'done' }, sort)).toMatchObject({
				kind: 'move-workspace',
				targetStatus: 'in-review',
			});
		}
	});

	test('keeps an issue leaving Backlog working under every sort', () => {
		for (const sort of ['manual', 'updated', 'priority'] as const) {
			expect(
				planBoardDrop(
					columnDrop({ sourceId: 'ENS-7', sourceKind: 'issue' }),
					{},
					sort,
				),
			).toMatchObject({ kind: 'assign-issue' });
		}
	});
});

describe('planBoardDrop for the issues-only Backlog column', () => {
	test('rejects a workspace dropped on the Backlog column', () => {
		expect(
			planBoardDrop(columnDrop({ targetColumnStatus: 'backlog' }), {}),
		).toBeNull();
	});

	test('rejects a workspace dropped on an issue card', () => {
		expect(planBoardDrop(cardDrop({ targetCardKind: 'issue' }), {})).toBeNull();
	});

	test('moves a workspace dropped on a dismissed issue card in Canceled', () => {
		expect(
			planBoardDrop(
				cardDrop({
					targetCardId: 'ENS-9',
					targetCardKind: 'issue',
					targetColumnStatus: 'canceled',
				}),
				{},
			),
		).toMatchObject({ kind: 'move-workspace', targetStatus: 'canceled' });
	});
});

describe('planBoardDrop for issue cards', () => {
	const issueDrop = (overrides: Partial<BoardDrop> = {}): BoardDrop =>
		columnDrop({ sourceId: 'ENS-7', sourceKind: 'issue', ...overrides });

	test('asks to create a workspace when an issue leaves Backlog', () => {
		expect(planBoardDrop(issueDrop(), {})).toEqual({
			issueKey: 'ENS-7',
			kind: 'assign-issue',
			targetStatus: 'in-review',
		});
	});

	test('takes the status of the workspace card it landed on', () => {
		expect(
			planBoardDrop(
				issueDrop({
					targetCardId: 'w1',
					targetCardKind: 'workspace',
					targetColumnStatus: 'done',
				}),
				{ w1: 'done' },
			),
		).toMatchObject({ kind: 'assign-issue', targetStatus: 'done' });
	});

	test('falls back to the card status when the drop resolved no column', () => {
		expect(
			planBoardDrop(
				issueDrop({
					targetCardId: 'w1',
					targetCardKind: 'workspace',
					targetColumnStatus: null,
				}),
				{ w1: 'done' },
			),
		).toMatchObject({ kind: 'assign-issue', targetStatus: 'done' });
	});

	test('dismisses the issue instead when dropped on Canceled', () => {
		expect(
			planBoardDrop(issueDrop({ targetColumnStatus: 'canceled' }), {}),
		).toEqual({ issueKey: 'ENS-7', kind: 'dismiss-issue' });
	});

	test('restores a dismissed issue when dropped back on Backlog', () => {
		expect(
			planBoardDrop(issueDrop({ targetColumnStatus: 'backlog' }), {}),
		).toEqual({ issueKey: 'ENS-7', kind: 'restore-issue' });
	});

	test('restores when dropped onto an issue card sitting in Backlog', () => {
		expect(
			planBoardDrop(
				issueDrop({
					targetCardId: 'ENS-9',
					targetCardKind: 'issue',
					targetColumnStatus: 'backlog',
				}),
				{},
			),
		).toEqual({ issueKey: 'ENS-7', kind: 'restore-issue' });
	});

	test('dismisses when dropped onto a dismissed issue card in Canceled', () => {
		expect(
			planBoardDrop(
				issueDrop({
					targetCardId: 'ENS-9',
					targetCardKind: 'issue',
					targetColumnStatus: 'canceled',
				}),
				{},
			),
		).toEqual({ issueKey: 'ENS-7', kind: 'dismiss-issue' });
	});
});
