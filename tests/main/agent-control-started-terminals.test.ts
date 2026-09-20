import { describe, expect, it } from 'vitest';

import {
	createStartedTerminalRegistry,
	MAX_TRACKED_TERMINALS,
} from '../../src/main/agent-control/started-terminals.ts';

/** Records one start, defaulting the root tree to the session's own id. */
const record = (
	registry: ReturnType<typeof createStartedTerminalRegistry>,
	sessionId: string,
	terminalId: string,
	rootSessionId = sessionId,
): void => registry.record({ rootSessionId, sessionId, terminalId });

describe('agent-control started-terminal registry', () => {
	it('recognises the session that started a terminal', () => {
		const registry = createStartedTerminalRegistry();
		record(registry, 'session-a', 'term-1');
		expect(registry.wasStartedBy('session-a', 'term-1')).toBe(true);
	});

	// The whole point: another session in the same workspace passes the scope
	// check and must still be refused the close.
	it('does not recognise a different session', () => {
		const registry = createStartedTerminalRegistry();
		record(registry, 'session-a', 'term-1');
		expect(registry.wasStartedBy('session-b', 'term-1')).toBe(false);
	});

	it('does not recognise a terminal nobody recorded', () => {
		const registry = createStartedTerminalRegistry();
		expect(registry.wasStartedBy('session-a', 'term-unknown')).toBe(false);
	});

	it('forgets a terminal once its tab is gone', () => {
		const registry = createStartedTerminalRegistry();
		record(registry, 'session-a', 'term-1');
		registry.forget('term-1');
		expect(registry.wasStartedBy('session-a', 'term-1')).toBe(false);
	});

	// A start is recorded per terminal rather than per live session, so without a
	// cap the map would grow for the life of the app. Eviction drops the oldest,
	// which is why the newest record survives a flood and the first does not.
	it('evicts the oldest records past its cap', () => {
		const registry = createStartedTerminalRegistry();
		record(registry, 'session-a', 'term-first');
		for (let index = 0; index < MAX_TRACKED_TERMINALS; index += 1) {
			record(registry, 'session-a', `term-filler-${index}`);
		}
		expect(registry.wasStartedBy('session-a', 'term-first')).toBe(false);
		expect(
			registry.wasStartedBy(
				'session-a',
				`term-filler-${MAX_TRACKED_TERMINALS - 1}`,
			),
		).toBe(true);
	});

	// The budget follows the delegation tree, not the one session that happened
	// to type the op, so a manager and its children share one allowance.
	it('counts every open terminal of one delegation tree', () => {
		const registry = createStartedTerminalRegistry();
		record(registry, 'manager', 'term-1', 'root');
		record(registry, 'leaf', 'term-2', 'root');
		record(registry, 'stranger', 'term-3', 'other-root');
		expect(
			registry.countOpen('root', new Set(['term-1', 'term-2', 'term-3'])),
		).toBe(2);
	});

	// The whole fix: an id the live listing no longer reports has already given
	// its slot back, whether the agent closed it or the user did.
	it('stops counting a terminal that is no longer open', () => {
		const registry = createStartedTerminalRegistry();
		record(registry, 'session-a', 'term-1');
		record(registry, 'session-a', 'term-2');
		expect(registry.countOpen('session-a', new Set(['term-2']))).toBe(1);
	});

	// A terminal the user started is open too, and it is not the agent's budget.
	it('ignores an open terminal no session recorded', () => {
		const registry = createStartedTerminalRegistry();
		expect(registry.countOpen('session-a', new Set(['term-users-own']))).toBe(
			0,
		);
	});
});
