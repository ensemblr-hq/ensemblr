import { describe, expect, test } from 'vitest';

import {
	applyBoardStatus,
	BOARD_STATUS_LABELS,
	BOARD_STATUS_ORDER,
	DEFAULT_BOARD_STATUS,
	resolveBoardStatus,
} from '../../src/renderer/state/workspace';

describe('resolveBoardStatus', () => {
	test('returns the stored status for a known workspace', () => {
		expect(resolveBoardStatus({ w1: 'in-review' }, 'w1')).toBe('in-review');
	});

	test('falls back to the default status when unset', () => {
		expect(resolveBoardStatus({}, 'w1')).toBe(DEFAULT_BOARD_STATUS);
	});
});

describe('applyBoardStatus', () => {
	test('sets a non-default status', () => {
		expect(applyBoardStatus({}, 'w1', 'in-review')).toEqual({
			w1: 'in-review',
		});
	});

	test('removes the key when set to the default status', () => {
		expect(
			applyBoardStatus({ w1: 'done' }, 'w1', DEFAULT_BOARD_STATUS),
		).toEqual({});
	});

	test('returns the same reference on a no-op', () => {
		const map = { w1: 'done' as const };
		expect(applyBoardStatus(map, 'w1', 'done')).toBe(map);
		const empty = {};
		expect(applyBoardStatus(empty, 'w1', DEFAULT_BOARD_STATUS)).toBe(empty);
	});
});

describe('board status metadata', () => {
	test('the default status is part of the column order', () => {
		expect(BOARD_STATUS_ORDER).toContain(DEFAULT_BOARD_STATUS);
	});

	test('every ordered status has a label', () => {
		for (const status of BOARD_STATUS_ORDER) {
			expect(BOARD_STATUS_LABELS[status]).toBeTruthy();
		}
	});
});
