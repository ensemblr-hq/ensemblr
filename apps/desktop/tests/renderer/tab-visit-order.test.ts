import { describe, expect, test } from 'vitest';

import {
	recordTabVisit,
	selectPreviouslyVisitedTab,
} from '../../src/renderer/state/workspace/tab-visit-order';

describe('recordTabVisit', () => {
	test('promotes the visited tab to the front of its workspace list', () => {
		const visits = { ws: ['b', 'a'] };

		expect(recordTabVisit(visits, { tabId: 'c', workspaceId: 'ws' })).toEqual({
			ws: ['c', 'b', 'a'],
		});
	});

	test('moves a revisited tab to the front instead of duplicating it', () => {
		const visits = { ws: ['c', 'b', 'a'] };

		expect(recordTabVisit(visits, { tabId: 'a', workspaceId: 'ws' })).toEqual({
			ws: ['a', 'c', 'b'],
		});
	});

	test('returns the same map when the tab is already active', () => {
		const visits = { ws: ['a', 'b'] };

		expect(recordTabVisit(visits, { tabId: 'a', workspaceId: 'ws' })).toBe(
			visits,
		);
	});

	test('leaves other workspaces untouched', () => {
		const visits = { other: ['x'], ws: ['a'] };
		const next = recordTabVisit(visits, { tabId: 'b', workspaceId: 'ws' });

		expect(next.other).toBe(visits.other);
		expect(visits.ws).toEqual(['a']);
	});

	test('caps the remembered history', () => {
		const visits = {
			ws: Array.from({ length: 24 }, (_, index) => `tab-${index}`),
		};
		const next = recordTabVisit(visits, { tabId: 'fresh', workspaceId: 'ws' });

		expect(next.ws).toHaveLength(24);
		expect(next.ws[0]).toBe('fresh');
		expect(next.ws).not.toContain('tab-23');
	});
});

describe('selectPreviouslyVisitedTab', () => {
	test('returns the tab visited before the one being closed', () => {
		expect(
			selectPreviouslyVisitedTab({
				excludeId: 'c',
				openIds: ['a', 'b', 'c'],
				visitOrder: ['c', 'a', 'b'],
			}),
		).toBe('a');
	});

	test('skips tabs that are no longer open', () => {
		expect(
			selectPreviouslyVisitedTab({
				excludeId: 'c',
				openIds: ['a', 'c'],
				visitOrder: ['c', 'gone', 'a'],
			}),
		).toBe('a');
	});

	test('returns null when the history holds no other open tab', () => {
		expect(
			selectPreviouslyVisitedTab({
				excludeId: 'c',
				openIds: ['c'],
				visitOrder: ['c', 'gone'],
			}),
		).toBeNull();
	});

	test('returns the most recent open tab when nothing is excluded', () => {
		expect(
			selectPreviouslyVisitedTab({
				openIds: ['setup', 'run'],
				visitOrder: ['terminal:1', 'run', 'setup'],
			}),
		).toBe('run');
	});
});
