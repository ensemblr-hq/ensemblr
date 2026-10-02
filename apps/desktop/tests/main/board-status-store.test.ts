import { describe, expect, it } from 'vitest';

import { createBoardStatusStore } from '../../src/main/agent-control/board-status-store.ts';

describe('board-status store', () => {
	it('defaults an unknown workspace to backlog', () => {
		const store = createBoardStatusStore();
		expect(store.get('nope')).toBe('backlog');
	});

	it('setOne stores a valid status and ignores an unknown one', () => {
		const store = createBoardStatusStore();
		store.setOne('ws', 'in-progress');
		expect(store.get('ws')).toBe('in-progress');
		store.setOne('ws', 'not-a-status');
		expect(store.get('ws')).toBe('in-progress');
	});

	it('setOne with the default status clears the entry', () => {
		const store = createBoardStatusStore();
		store.setOne('ws', 'done');
		store.setOne('ws', 'backlog');
		expect(store.get('ws')).toBe('backlog');
	});

	it('replaceAll swaps the whole map and drops invalid entries', () => {
		const store = createBoardStatusStore();
		store.setOne('stale', 'done');
		store.replaceAll({ a: 'in-review', b: 'bogus', c: 'canceled' });
		expect(store.get('a')).toBe('in-review');
		expect(store.get('b')).toBe('backlog');
		expect(store.get('c')).toBe('canceled');
		expect(store.get('stale')).toBe('backlog');
	});
});
