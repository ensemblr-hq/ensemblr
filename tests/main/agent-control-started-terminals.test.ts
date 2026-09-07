import { describe, expect, it } from 'vitest';

import {
	createStartedTerminalRegistry,
	MAX_TRACKED_TERMINALS,
} from '../../src/main/agent-control/started-terminals.ts';

describe('agent-control started-terminal registry', () => {
	it('recognises the session that started a terminal', () => {
		const registry = createStartedTerminalRegistry();
		registry.record('session-a', 'term-1');
		expect(registry.wasStartedBy('session-a', 'term-1')).toBe(true);
	});

	// The whole point: another session in the same workspace passes the scope
	// check and must still be refused the close.
	it('does not recognise a different session', () => {
		const registry = createStartedTerminalRegistry();
		registry.record('session-a', 'term-1');
		expect(registry.wasStartedBy('session-b', 'term-1')).toBe(false);
	});

	it('does not recognise a terminal nobody recorded', () => {
		const registry = createStartedTerminalRegistry();
		expect(registry.wasStartedBy('session-a', 'term-unknown')).toBe(false);
	});

	it('forgets a terminal once its tab is gone', () => {
		const registry = createStartedTerminalRegistry();
		registry.record('session-a', 'term-1');
		registry.forget('term-1');
		expect(registry.wasStartedBy('session-a', 'term-1')).toBe(false);
	});

	// A start is recorded per terminal rather than per live session, so without a
	// cap the map would grow for the life of the app. Eviction drops the oldest,
	// which is why the newest record survives a flood and the first does not.
	it('evicts the oldest records past its cap', () => {
		const registry = createStartedTerminalRegistry();
		registry.record('session-a', 'term-first');
		for (let index = 0; index < MAX_TRACKED_TERMINALS; index += 1) {
			registry.record('session-a', `term-filler-${index}`);
		}
		expect(registry.wasStartedBy('session-a', 'term-first')).toBe(false);
		expect(
			registry.wasStartedBy(
				'session-a',
				`term-filler-${MAX_TRACKED_TERMINALS - 1}`,
			),
		).toBe(true);
	});
});
