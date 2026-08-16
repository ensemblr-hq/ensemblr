import { describe, expect, test } from 'vitest';

import { BOARD_CARD_DRAG_TYPE } from '../../src/renderer/components/workbench-shell/dashboard/use-card-dnd';
import { resolveBoardDrop } from '../../src/renderer/hooks/workbench-shell/dashboard/use-board-drag';

const workspaceCard = (cardId: string) => ({
	cardId,
	cardKind: 'workspace',
	type: BOARD_CARD_DRAG_TYPE,
});

describe('resolveBoardDrop', () => {
	test('returns null when the source has no card id', () => {
		expect(
			resolveBoardDrop(
				{ cardKind: 'workspace', type: BOARD_CARD_DRAG_TYPE },
				[],
			),
		).toBeNull();
	});

	test('returns null when the source has no recognised card kind', () => {
		expect(
			resolveBoardDrop({ cardId: 'a', cardKind: 'column' }, []),
		).toBeNull();
	});

	test('resolves a card target as a reorder drop', () => {
		const drop = resolveBoardDrop(workspaceCard('a'), [
			{ data: workspaceCard('b') },
		]);
		expect(drop).toMatchObject({
			sourceId: 'a',
			sourceKind: 'workspace',
			targetCardId: 'b',
			targetCardKind: 'workspace',
			targetColumnStatus: null,
		});
	});

	test('prefers a card target but still carries its enclosing column', () => {
		const drop = resolveBoardDrop(workspaceCard('a'), [
			{ data: workspaceCard('b') },
			{ data: { status: 'done', type: 'board-column' } },
		]);
		expect(drop).toMatchObject({
			targetCardId: 'b',
			targetColumnStatus: 'done',
		});
	});

	test('carries Canceled through a drop onto a dismissed issue card', () => {
		const drop = resolveBoardDrop(
			{ cardId: 'ENS-7', cardKind: 'issue', type: BOARD_CARD_DRAG_TYPE },
			[
				{
					data: {
						cardId: 'ENS-9',
						cardKind: 'issue',
						type: BOARD_CARD_DRAG_TYPE,
					},
				},
				{ data: { status: 'canceled', type: 'board-column' } },
			],
		);
		expect(drop).toMatchObject({
			targetCardId: 'ENS-9',
			targetCardKind: 'issue',
			targetColumnStatus: 'canceled',
		});
	});

	test('resolves a column target as a cross-column drop', () => {
		const drop = resolveBoardDrop(workspaceCard('a'), [
			{ data: { status: 'in-review', type: 'board-column' } },
		]);
		expect(drop).toEqual({
			edge: null,
			sourceId: 'a',
			sourceKind: 'workspace',
			targetCardId: null,
			targetCardKind: null,
			targetColumnStatus: 'in-review',
		});
	});

	test('carries the issue kind through from an issue card source', () => {
		const drop = resolveBoardDrop(
			{ cardId: 'ENS-7', cardKind: 'issue', type: BOARD_CARD_DRAG_TYPE },
			[{ data: { status: 'canceled', type: 'board-column' } }],
		);
		expect(drop).toMatchObject({ sourceId: 'ENS-7', sourceKind: 'issue' });
	});

	test('returns null for an unknown column status', () => {
		expect(
			resolveBoardDrop(workspaceCard('a'), [
				{ data: { status: 'archived', type: 'board-column' } },
			]),
		).toBeNull();
	});
});
