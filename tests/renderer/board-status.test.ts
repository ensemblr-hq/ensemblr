import { describe, expect, test } from 'vitest';

import { i18n } from '../../src/renderer/lib/i18n';

import { boardStatusLabel } from '../../src/renderer/lib/workbench/board-status-presentation';
import {
	applyBoardStatus,
	BOARD_STATUS_ORDER,
	DEFAULT_BOARD_STATUS,
	resolveBoardStatus,
	WORKSPACE_BOARD_STATUSES_ASSIGNABLE,
} from '../../src/renderer/state/workspace';

describe('resolveBoardStatus', () => {
	test('returns the stored status for a known workspace', () => {
		expect(resolveBoardStatus({ w1: 'in-review' }, 'w1')).toBe('in-review');
	});

	test('falls back to the default status when unset', () => {
		expect(resolveBoardStatus({}, 'w1')).toBe(DEFAULT_BOARD_STATUS);
	});

	test('a workspace defaults to In progress, never the issues-only Backlog', () => {
		expect(DEFAULT_BOARD_STATUS).toBe('in-progress');
	});

	test('coerces a status stored before Backlog became issues-only', () => {
		expect(resolveBoardStatus({ w1: 'backlog' }, 'w1')).toBe('in-progress');
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

	test('coerces a Backlog write onto the default, clearing a stale entry', () => {
		expect(applyBoardStatus({ w1: 'done' }, 'w1', 'backlog')).toEqual({});
		expect(applyBoardStatus({ w1: 'backlog' }, 'w1', 'backlog')).toEqual({});
	});
});

describe('board status metadata', () => {
	test('the default status is part of the column order', () => {
		expect(BOARD_STATUS_ORDER).toContain(DEFAULT_BOARD_STATUS);
	});

	test('every column but Backlog can be assigned to a workspace', () => {
		expect(WORKSPACE_BOARD_STATUSES_ASSIGNABLE).toEqual(
			BOARD_STATUS_ORDER.filter((status) => status !== 'backlog'),
		);
	});

	test('every ordered status has a label', () => {
		for (const status of BOARD_STATUS_ORDER) {
			expect(boardStatusLabel(i18n.t, status)).toBeTruthy();
		}
	});
});
