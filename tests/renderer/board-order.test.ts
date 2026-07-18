import { describe, expect, test } from 'vitest';

import {
	moveToColumnEnd,
	orderColumnWorkspaceIds,
	reorderBoardOrder,
} from '../../src/renderer/state/workspace/board-order';

describe('orderColumnWorkspaceIds', () => {
	test('sorts column ids by their board-order position', () => {
		expect(orderColumnWorkspaceIds(['c', 'a', 'b'], ['a', 'b', 'c'])).toEqual([
			'c',
			'a',
			'b',
		]);
	});

	test('appends ids missing from the order, keeping their relative order', () => {
		expect(orderColumnWorkspaceIds(['b'], ['a', 'b', 'c'])).toEqual([
			'b',
			'a',
			'c',
		]);
	});
});

describe('reorderBoardOrder', () => {
	test('inserts the source before the target', () => {
		expect(reorderBoardOrder(['a', 'b', 'c'], 'c', 'a', false)).toEqual([
			'c',
			'a',
			'b',
		]);
	});

	test('inserts the source after the target', () => {
		expect(reorderBoardOrder(['a', 'b', 'c'], 'a', 'b', true)).toEqual([
			'b',
			'a',
			'c',
		]);
	});

	test('appends the source when the target is absent', () => {
		expect(reorderBoardOrder(['a', 'b'], 'a', 'z', false)).toEqual(['b', 'a']);
	});
});

describe('moveToColumnEnd', () => {
	test('moves the source after the last id in the target status column', () => {
		const statusById = {
			a: 'done',
			b: 'backlog',
			c: 'done',
		} as const;
		expect(moveToColumnEnd(['a', 'b', 'c'], 'b', 'done', statusById)).toEqual([
			'a',
			'c',
			'b',
		]);
	});

	test('moves the source to the front when the column is empty', () => {
		const statusById = { a: 'backlog', b: 'backlog' } as const;
		expect(moveToColumnEnd(['a', 'b'], 'a', 'done', statusById)).toEqual([
			'a',
			'b',
		]);
	});
});
