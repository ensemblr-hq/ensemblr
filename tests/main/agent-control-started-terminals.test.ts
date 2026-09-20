import { describe, expect, it } from 'vitest';

import {
	createStartedTerminalRegistry,
	MAX_TRACKED_TERMINALS,
} from '../../src/main/agent-control/started-terminals.ts';

const WORKSPACE = 'ws';

/** Records one start, defaulting the root tree to the session's own id. */
const record = (
	registry: ReturnType<typeof createStartedTerminalRegistry>,
	sessionId: string,
	terminalId: string,
	rootSessionId = sessionId,
	workspaceId = WORKSPACE,
): void =>
	registry.record({ rootSessionId, sessionId, terminalId, workspaceId });

/** Counts one tree's open terminals in the default workspace. */
const countOpen = (
	registry: ReturnType<typeof createStartedTerminalRegistry>,
	rootSessionId: string,
	openTerminalIds: Iterable<string>,
	workspaceId = WORKSPACE,
): number =>
	registry.countOpen({
		openTerminalIds: new Set(openTerminalIds),
		rootSessionId,
		workspaceId,
	});

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
		expect(countOpen(registry, 'root', ['term-1', 'term-2', 'term-3'])).toBe(2);
	});

	// The whole fix: an id the live listing no longer reports has already given
	// its slot back, whether the agent closed it or the user did.
	it('stops counting a terminal that is no longer open', () => {
		const registry = createStartedTerminalRegistry();
		record(registry, 'session-a', 'term-1');
		record(registry, 'session-a', 'term-2');
		expect(countOpen(registry, 'session-a', ['term-2'])).toBe(1);
	});

	// A terminal the user started is open too, and it is not the agent's budget.
	it('ignores an open terminal no session recorded', () => {
		const registry = createStartedTerminalRegistry();
		expect(countOpen(registry, 'session-a', ['term-users-own'])).toBe(0);
	});

	// Counting is also what prunes: the live listing is the only thing that knows
	// a terminal is gone, since the user closing a tab tells this registry
	// nothing.
	it('drops the record of a terminal the listing no longer reports', () => {
		const registry = createStartedTerminalRegistry();
		record(registry, 'session-a', 'term-1');

		countOpen(registry, 'session-a', []);

		expect(registry.wasStartedBy('session-a', 'term-1')).toBe(false);
	});

	// Another workspace's terminals are not absent from the listing, they are out
	// of frame — pruning on them would discard live records wholesale.
	it('prunes only the workspace it was asked about', () => {
		const registry = createStartedTerminalRegistry();
		record(registry, 'session-a', 'term-elsewhere', 'session-a', 'ws-other');

		countOpen(registry, 'session-a', []);

		expect(registry.wasStartedBy('session-a', 'term-elsewhere')).toBe(true);
	});

	// The eviction cap must never reach a live terminal: doing so would both
	// refuse its owner the close and hand the tree a free slot. Pruning on every
	// count is what keeps the map far below the cap, so this walks the same
	// start-then-count rhythm the service uses and checks the first terminal is
	// still counted long past the cap's worth of later starts.
	it('never evicts a live terminal across a long run of later starts', () => {
		const registry = createStartedTerminalRegistry();
		record(registry, 'session-a', 'term-long-lived');

		for (let start = 0; start < MAX_TRACKED_TERMINALS * 2; start += 1) {
			countOpen(registry, 'session-a', ['term-long-lived']);
			record(registry, 'session-a', `term-churn-${start}`);
		}

		expect(countOpen(registry, 'session-a', ['term-long-lived'])).toBe(1);
		expect(registry.wasStartedBy('session-a', 'term-long-lived')).toBe(true);
	});
});
