import { describe, expect, test } from 'vitest';

import { planBoardDrop } from '../../src/renderer/components/workbench-shell/dashboard/plan-board-drop';
import type { BoardDrop } from '../../src/renderer/components/workbench-shell/dashboard/use-board-drag';

const cardDrop = (overrides: Partial<BoardDrop> = {}): BoardDrop => ({
	edge: 'top',
	sourceId: 'a',
	targetCardId: 'b',
	targetColumnStatus: null,
	...overrides,
});

const columnDrop = (overrides: Partial<BoardDrop> = {}): BoardDrop => ({
	edge: null,
	sourceId: 'a',
	targetCardId: null,
	targetColumnStatus: 'in-review',
	...overrides,
});

describe('planBoardDrop', () => {
	test('takes the target card status for a card drop', () => {
		const plan = planBoardDrop(cardDrop(), { b: 'done' });
		expect(plan).toEqual({
			placeAfter: false,
			sourceId: 'a',
			targetCardId: 'b',
			targetStatus: 'done',
		});
	});

	test('defaults the target status when the target card has none', () => {
		const plan = planBoardDrop(cardDrop(), {});
		expect(plan?.targetStatus).toBe('backlog');
	});

	test('marks placeAfter when dropping on a card bottom edge', () => {
		const plan = planBoardDrop(cardDrop({ edge: 'bottom' }), { b: 'done' });
		expect(plan?.placeAfter).toBe(true);
	});

	test('uses the column status for a whitespace drop', () => {
		const plan = planBoardDrop(columnDrop(), { a: 'backlog' });
		expect(plan).toEqual({
			placeAfter: false,
			sourceId: 'a',
			targetCardId: null,
			targetStatus: 'in-review',
		});
	});

	test('is a no-op when a whitespace drop lands in the source column', () => {
		expect(planBoardDrop(columnDrop(), { a: 'in-review' })).toBeNull();
	});

	test('reorders within the source column when dropping on a sibling card', () => {
		const plan = planBoardDrop(cardDrop({ edge: 'bottom' }), {
			a: 'done',
			b: 'done',
		});
		expect(plan).toEqual({
			placeAfter: true,
			sourceId: 'a',
			targetCardId: 'b',
			targetStatus: 'done',
		});
	});

	test('returns null when a whitespace drop has no resolvable status', () => {
		expect(
			planBoardDrop(columnDrop({ targetColumnStatus: null }), {}),
		).toBeNull();
	});
});
