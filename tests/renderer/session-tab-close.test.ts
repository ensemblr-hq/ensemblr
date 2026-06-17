import { describe, expect, test } from 'bun:test';

import {
	type ActiveCloseDecision,
	decideActiveClose,
	resolveRunningCloseTarget,
	selectNeighborTab,
} from '../../src/renderer/state/workspace/session-tab-close';
import type { SessionTabModel } from '../../src/renderer/types/workbench';

function createTab(overrides: Partial<SessionTabModel> = {}): SessionTabModel {
	return {
		chatTabId: 'chat-1',
		id: 'chat-1',
		kind: 'chat',
		label: 'Chat',
		piSessionId: null,
		status: 'idle',
		summary: '',
		updatedLabel: '',
		...overrides,
	};
}

describe('selectNeighborTab', () => {
	const tabs = ['a', 'b', 'c'] as const;

	test('prefers the right neighbor', () => {
		expect(selectNeighborTab(tabs, 0)).toBe('b');
		expect(selectNeighborTab(tabs, 1)).toBe('c');
	});

	test('falls back to the left neighbor when closing the rightmost tab', () => {
		expect(selectNeighborTab(tabs, 2)).toBe('b');
	});

	test('returns null when the only tab closes', () => {
		expect(selectNeighborTab(['solo'], 0)).toBeNull();
	});

	test('returns null for an out-of-range index', () => {
		expect(selectNeighborTab(tabs, -1)).toBeNull();
	});
});

describe('decideActiveClose', () => {
	test('closes the active tab when more than one is open', () => {
		const active = createTab({ id: 'chat-2', piSessionId: 'pi-2' });
		const decision = decideActiveClose(
			[createTab(), active],
			active,
		) satisfies ActiveCloseDecision;
		expect(decision).toEqual({ kind: 'close', activeId: 'chat-2' });
	});

	test('no-ops when the sole tab is a fresh, unbound chat', () => {
		const active = createTab({ piSessionId: null });
		expect(decideActiveClose([active], active)).toEqual({ kind: 'noop' });
	});

	test('resets when the sole tab has a Pi session bound', () => {
		const active = createTab({ id: 'chat-9', piSessionId: 'pi-9' });
		expect(decideActiveClose([active], active)).toEqual({
			kind: 'reset',
			activeId: 'chat-9',
		});
	});
});

describe('resolveRunningCloseTarget', () => {
	test('uses the live streaming flag for the active tab', () => {
		const active = createTab({ id: 'chat-1', piSessionId: 'pi-1' });
		expect(
			resolveRunningCloseTarget({
				activeSessionId: 'chat-1',
				isActiveStreaming: true,
				tabs: [active],
				targetId: 'chat-1',
			}),
		).toEqual({ isRunning: true, piSessionId: 'pi-1' });
	});

	test('reports the active tab as idle when it is not streaming', () => {
		// `status` is 'working' but the live composer flag wins for the active tab.
		const active = createTab({
			id: 'chat-1',
			piSessionId: 'pi-1',
			status: 'working',
		});
		expect(
			resolveRunningCloseTarget({
				activeSessionId: 'chat-1',
				isActiveStreaming: false,
				tabs: [active],
				targetId: 'chat-1',
			}),
		).toEqual({ isRunning: false, piSessionId: 'pi-1' });
	});

	test('falls back to persisted status for a background tab', () => {
		const background = createTab({
			id: 'chat-2',
			piSessionId: 'pi-2',
			status: 'working',
		});
		expect(
			resolveRunningCloseTarget({
				activeSessionId: 'chat-1',
				isActiveStreaming: false,
				tabs: [createTab(), background],
				targetId: 'chat-2',
			}),
		).toEqual({ isRunning: true, piSessionId: 'pi-2' });
	});

	test('reports an idle background tab as not running', () => {
		const background = createTab({ id: 'chat-2', piSessionId: 'pi-2' });
		expect(
			resolveRunningCloseTarget({
				activeSessionId: 'chat-1',
				isActiveStreaming: true,
				tabs: [createTab(), background],
				targetId: 'chat-2',
			}),
		).toEqual({ isRunning: false, piSessionId: 'pi-2' });
	});

	test('treats an unknown target as not running with no session', () => {
		expect(
			resolveRunningCloseTarget({
				activeSessionId: 'chat-1',
				isActiveStreaming: true,
				tabs: [createTab()],
				targetId: 'missing',
			}),
		).toEqual({ isRunning: false, piSessionId: null });
	});
});
