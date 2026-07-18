import { describe, expect, test } from 'vitest';

import {
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
