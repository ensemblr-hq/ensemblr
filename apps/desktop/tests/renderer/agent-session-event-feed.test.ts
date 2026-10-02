// @vitest-environment happy-dom

/**
 * Five renderer hooks each subscribed to the agent session event stream, and
 * each subscription registered its own listener on the preload bridge — so one
 * broadcast crossed the bridge five times, and any one throwing listener could
 * end delivery for the rest. `subscribeAgentSessionEvents` now multiplexes every
 * subscriber over a single reference-counted bridge registration.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';

import { subscribeAgentSessionEvents } from '../../src/renderer/api/ensemblr/agent-sessions';
import type { AgentSessionEventBroadcast } from '../../src/shared/ipc/contracts/agent-session';
import { clearEnsemblrApi, installEnsemblrApi } from './support/dom';

type BridgeListener = (event: AgentSessionEventBroadcast) => void;

interface FakeBridge {
	emit: (event: AgentSessionEventBroadcast) => void;
	onAgentSessionEvent: ReturnType<typeof vi.fn>;
	release: ReturnType<typeof vi.fn>;
}

/** Builds a preload-bridge double that records registrations and fans out like `ipcRenderer.on`. */
function createFakeBridge(): FakeBridge {
	const registered = new Set<BridgeListener>();
	const release = vi.fn();
	const onAgentSessionEvent = vi.fn((listener: BridgeListener) => {
		registered.add(listener);
		return () => {
			release();
			registered.delete(listener);
		};
	});
	return {
		emit: (event) => {
			for (const listener of [...registered]) {
				listener(event);
			}
		},
		onAgentSessionEvent,
		release,
	};
}

/** Installs a fresh bridge double as `window.ensemblr`. */
function installFakeBridge(): FakeBridge {
	const bridge = createFakeBridge();
	installEnsemblrApi({ onAgentSessionEvent: bridge.onAgentSessionEvent });
	return bridge;
}

/** Builds a minimal status broadcast whose ordinal identifies it in assertions. */
function broadcast(ordinal: number): AgentSessionEventBroadcast {
	return {
		event: {
			branchId: 'branch-1',
			createdAt: '2026-01-01T00:00:00.000Z',
			eventType: 'status',
			id: `event-${ordinal}`,
			ordinal,
			payload: null,
			stream: 'protocol',
			turnId: null,
		},
		sessionId: 'session-1',
		workspaceId: 'workspace-1',
	};
}

const openSubscriptions: (() => void)[] = [];

/** Subscribes through the public API and remembers the release so `afterEach` can drain the shared feed. */
function subscribe(listener: BridgeListener): () => void {
	const release = subscribeAgentSessionEvents(listener);
	openSubscriptions.push(release);
	return release;
}

afterEach(() => {
	for (const release of openSubscriptions.splice(0)) {
		release();
	}
	clearEnsemblrApi();
	vi.restoreAllMocks();
});

describe('subscribeAgentSessionEvents', () => {
	test('registers one bridge listener for five subscribers', () => {
		const bridge = installFakeBridge();

		for (let index = 0; index < 5; index += 1) {
			subscribe(() => undefined);
		}

		expect(bridge.onAgentSessionEvent).toHaveBeenCalledTimes(1);
	});

	test('releases the bridge with the last subscriber and registers again on the next', () => {
		const bridge = installFakeBridge();
		const releases = [
			subscribe(() => undefined),
			subscribe(() => undefined),
			subscribe(() => undefined),
		];

		releases[0]();
		releases[1]();
		expect(bridge.release).not.toHaveBeenCalled();
		releases[2]();
		expect(bridge.release).toHaveBeenCalledTimes(1);

		subscribe(() => undefined);
		expect(bridge.onAgentSessionEvent).toHaveBeenCalledTimes(2);
	});

	test('delivers every event once to every subscriber, in emission order', () => {
		const bridge = installFakeBridge();
		const received = Array.from({ length: 5 }, () => [] as number[]);
		for (const sink of received) {
			subscribe((event) => {
				sink.push(event.event.ordinal);
			});
		}

		bridge.emit(broadcast(1));
		bridge.emit(broadcast(2));
		bridge.emit(broadcast(3));

		for (const sink of received) {
			expect(sink).toEqual([1, 2, 3]);
		}
	});

	test('calls a function subscribed twice twice and releases each subscription on its own', () => {
		const bridge = installFakeBridge();
		const listener = vi.fn();
		const releaseFirst = subscribe(listener);
		subscribe(listener);

		bridge.emit(broadcast(1));
		releaseFirst();
		releaseFirst();
		bridge.emit(broadcast(2));

		expect(listener).toHaveBeenCalledTimes(3);
		expect(bridge.release).not.toHaveBeenCalled();
	});

	test('keeps the in-flight event from a subscriber that joined during delivery', () => {
		const bridge = installFakeBridge();
		const late = vi.fn();
		let joined = false;
		subscribe(() => {
			if (!joined) {
				joined = true;
				subscribe(late);
			}
		});

		bridge.emit(broadcast(1));
		expect(late).not.toHaveBeenCalled();
		bridge.emit(broadcast(2));

		expect(late).toHaveBeenCalledTimes(1);
		expect(late.mock.calls[0]?.[0].event.ordinal).toBe(2);
	});

	test('skips a subscriber released earlier in the same delivery', () => {
		const bridge = installFakeBridge();
		const released = vi.fn();
		let releaseTarget = () => {};
		subscribe(() => {
			releaseTarget();
		});
		releaseTarget = subscribe(released);

		bridge.emit(broadcast(1));

		expect(released).not.toHaveBeenCalled();
	});

	test('isolates a throwing listener from the other subscribers', () => {
		const bridge = installFakeBridge();
		const consoleError = vi
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);
		const failure = new Error('listener failure');
		const before = vi.fn();
		const after = vi.fn();
		subscribe(before);
		subscribe(() => {
			throw failure;
		});
		subscribe(after);

		expect(() => bridge.emit(broadcast(1))).not.toThrow();
		bridge.emit(broadcast(2));

		expect(before).toHaveBeenCalledTimes(2);
		expect(after).toHaveBeenCalledTimes(2);
		expect(consoleError).toHaveBeenCalledWith(expect.any(String), failure);
	});

	test('moves every subscriber onto a replaced window.ensemblr bridge', () => {
		const first = installFakeBridge();
		const early = vi.fn();
		subscribe(early);
		const second = installFakeBridge();
		const late = vi.fn();
		subscribe(late);

		expect(first.release).toHaveBeenCalledTimes(1);
		expect(second.onAgentSessionEvent).toHaveBeenCalledTimes(1);

		first.emit(broadcast(1));
		second.emit(broadcast(2));

		expect(early).toHaveBeenCalledTimes(1);
		expect(early.mock.calls[0]?.[0].event.ordinal).toBe(2);
		expect(late).toHaveBeenCalledTimes(1);
	});

	test('releases the replacement bridge, and only it, when the last subscriber leaves', () => {
		const first = installFakeBridge();
		const releaseEarly = subscribe(() => undefined);
		const second = installFakeBridge();
		const releaseLate = subscribe(() => undefined);

		releaseEarly();
		expect(second.release).not.toHaveBeenCalled();
		releaseLate();

		expect(first.release).toHaveBeenCalledTimes(1);
		expect(second.release).toHaveBeenCalledTimes(1);
	});

	test('leaves no subscriber behind when the bridge refuses the registration', () => {
		installEnsemblrApi({
			onAgentSessionEvent: () => {
				throw new Error('bridge closed');
			},
		});
		expect(() => subscribeAgentSessionEvents(() => undefined)).toThrow(
			'bridge closed',
		);
		const bridge = installFakeBridge();
		const listener = vi.fn();

		subscribe(listener);
		bridge.emit(broadcast(1));
		bridge.release.mockClear();
		for (const release of openSubscriptions.splice(0)) {
			release();
		}

		expect(listener).toHaveBeenCalledTimes(1);
		expect(bridge.release).toHaveBeenCalledTimes(1);
	});

	test('does nothing without a bridge', () => {
		clearEnsemblrApi();

		const release = subscribeAgentSessionEvents(() => undefined);

		expect(() => release()).not.toThrow();
	});
});
