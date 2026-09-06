// @vitest-environment happy-dom

/**
 * A runtime broadcasts one event per streamed token, and the timeline folds each
 * one into the agent-event query cache. Two things used to make that the most
 * expensive loop in the app, and both are regression-guarded here.
 *
 * `useLiveSessionUsage` observed the raw event list, and it is reached from the
 * workspace route — so every token re-rendered the whole screen: tabs, composer,
 * dock, review panel, every message row and every popover inside them. It now
 * observes only the two gauge readings it draws.
 *
 * `useTimelineEvents` wrote the cache once per event, so React committed once
 * per token and the compositor stayed pinned at the display's refresh rate for
 * the length of the turn. It now folds a frame's worth of events at a time.
 *
 * Each of those two has a second half that the obvious test misses, so both are
 * driven from both sides here: the gauges through the query cache *and* through
 * the live broadcast feed they also subscribe to, and the buffer on a painting
 * window *and* on one that never paints at all.
 */

import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ensemblrQueryKeys } from '../../../src/renderer/api/ensemblr-queries';
import { useTimelineEvents } from '../../../src/renderer/hooks/workbench-shell/timeline/use-timeline-events';
import { useLiveSessionUsage } from '../../../src/renderer/state/composer/session-usage';
import type {
	AgentSessionEventBroadcast,
	AgentSessionEventWire,
	ListAgentSessionEventsResult,
} from '../../../src/shared/ipc/contracts/agent-session';
import { clearEnsemblrApi, createTestQueryClient } from '../support/dom';

const BRANCH_ID = 'branch-1';
const SESSION_ID = 'session-1';
const WORKSPACE_ID = 'ws-1';

/**
 * `MAX_BUFFERED_EVENTS`, restated. The buffer keeps it private and no production
 * code reads it, so exporting it would widen the module's surface for a test
 * alone. Restating it costs a red test if the cap moves, which is the cheaper
 * failure: the assertions below pin the boundary rather than the behaviour, so
 * they name the value that changed instead of going quiet.
 */
const BUFFER_CAP = 512;

/** Broadcast listeners the stubbed preload bridge has handed out. */
let listeners: ((broadcast: AgentSessionEventBroadcast) => void)[] = [];

/**
 * Installs a bridge whose only job is to hand this test the broadcast listener,
 * plus the empty events read the timeline's own query performs on mount.
 */
function installBridge(): void {
	listeners = [];
	(window as unknown as { ensemblr: unknown }).ensemblr = {
		listAgentSessionEvents: (): Promise<ListAgentSessionEventsResult> =>
			Promise.resolve({ events: [] }),
		onAgentSessionEvent: (
			listener: (broadcast: AgentSessionEventBroadcast) => void,
		) => {
			listeners.push(listener);
			return () => {
				listeners = listeners.filter((entry) => entry !== listener);
			};
		},
	};
}

/**
 * Drains the query client's notification queue and React's work, so a phase's
 * renders have all landed before the next phase is measured. Query schedules
 * observer notifications through `setTimeout(…, 0)`, so awaiting microtasks
 * alone leaves them queued and the assertions race the notification.
 */
async function settle(): Promise<void> {
	for (let pass = 0; pass < 2; pass += 1) {
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 0);
			});
		});
	}
}

/** Waits for the animation frame the timeline's broadcast buffer flushes on. */
async function settleFrame(): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => {
			requestAnimationFrame(() => resolve(undefined));
		});
	});
	await settle();
}

/** One streamed text delta, as the main process synthesizes it. */
function textDelta(ordinal: number): AgentSessionEventWire {
	return {
		branchId: BRANCH_ID,
		createdAt: new Date(0).toISOString(),
		eventType: 'message',
		id: `delta-${ordinal}`,
		ordinal,
		payload: {
			kind: 'message',
			payload: { kind: 'text-delta', text: `chunk ${ordinal}` },
			role: 'agent',
		},
		stream: 'protocol',
		turnId: 'turn-1',
	} as unknown as AgentSessionEventWire;
}

/** A context-usage reading, which is one of the two events the gauges care about. */
function contextUsage(ordinal: number, tokens: number): AgentSessionEventWire {
	return {
		branchId: BRANCH_ID,
		createdAt: new Date(0).toISOString(),
		eventType: 'context-usage',
		id: `usage-${ordinal}`,
		ordinal,
		payload: {
			kind: 'context-usage',
			usage: { contextWindow: 200_000, percent: null, tokens },
		},
		stream: 'protocol',
		turnId: 'turn-1',
	} as unknown as AgentSessionEventWire;
}

/** Appends events to the cached list the way the timeline's own merge would. */
function appendToCache(
	client: QueryClient,
	events: readonly AgentSessionEventWire[],
): void {
	client.setQueryData<ListAgentSessionEventsResult>(
		ensemblrQueryKeys.agentSessionEvents(BRANCH_ID),
		(previous) => ({ events: [...(previous?.events ?? []), ...events] }),
	);
}

/** Delivers one broadcast to every subscriber, as the preload bridge would. */
function broadcast(event: AgentSessionEventWire): void {
	for (const listener of [...listeners]) {
		listener({ event, sessionId: SESSION_ID, workspaceId: WORKSPACE_ID });
	}
}

/** Wraps a hook under a query client, the one provider these hooks need. */
function providerFor(client: QueryClient) {
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
}

afterEach(() => {
	clearEnsemblrApi();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('streaming render load', () => {
	test('the usage gauges ignore tokens that move neither reading', async () => {
		installBridge();
		const client = createTestQueryClient();

		let renders = 0;
		const { result } = renderHook(
			() => {
				renders += 1;
				return useLiveSessionUsage({
					activeSessionId: SESSION_ID,
					branchId: BRANCH_ID,
					model: undefined,
					workspaceId: WORKSPACE_ID,
				});
			},
			{ wrapper: providerFor(client) },
		);
		await settle();

		await act(async () => {
			appendToCache(client, [contextUsage(1, 1_000)]);
		});
		await settle();
		expect(result.current.contextUsage?.usedTokens).toBe(1_000);

		const rendersBeforeStream = renders;
		await act(async () => {
			for (let ordinal = 2; ordinal < 42; ordinal += 1) {
				appendToCache(client, [textDelta(ordinal)]);
			}
		});
		await settle();
		expect(renders).toBe(rendersBeforeStream);

		await act(async () => {
			appendToCache(client, [contextUsage(99, 2_500)]);
		});
		await settle();
		expect(renders).toBeGreaterThan(rendersBeforeStream);
		expect(result.current.contextUsage?.usedTokens).toBe(2_500);
	});

	/**
	 * The gauges have two feeds and the test above covers one of them. Alongside
	 * the query cache, `useLiveSessionUsage` subscribes to the raw broadcast
	 * stream through `useAgentSessionEventSync`, which sees every streamed token
	 * and stays cheap only because it discards anything that is not a usage
	 * reading before it touches state. Widening that filter would put the
	 * workspace route back on the per-token render path with the cache-side guard
	 * still green, so the same claim is driven through the live feed here.
	 */
	test('the live feed wakes the gauges for a usage reading and nothing else', async () => {
		installBridge();
		const client = createTestQueryClient();

		let renders = 0;
		const { result } = renderHook(
			() => {
				renders += 1;
				return useLiveSessionUsage({
					activeSessionId: SESSION_ID,
					branchId: BRANCH_ID,
					model: undefined,
					workspaceId: WORKSPACE_ID,
				});
			},
			{ wrapper: providerFor(client) },
		);
		await settle();

		const rendersBeforeStream = renders;
		act(() => {
			for (let ordinal = 1; ordinal <= 40; ordinal += 1) {
				broadcast(textDelta(ordinal));
			}
		});
		await settle();
		expect(renders).toBe(rendersBeforeStream);
		expect(result.current.contextUsage).toBeNull();

		act(() => {
			broadcast(contextUsage(41, 3_200));
		});
		await settle();

		expect(renders).toBeGreaterThan(rendersBeforeStream);
		expect(result.current.contextUsage?.usedTokens).toBe(3_200);
	});

	test('a burst of deltas costs one cache write, not one per token', async () => {
		installBridge();
		const client = createTestQueryClient();
		const { result } = renderHook(
			() => useTimelineEvents({ branchId: BRANCH_ID, sessionId: SESSION_ID }),
			{ wrapper: providerFor(client) },
		);
		await settle();

		const setQueryData = vi.spyOn(client, 'setQueryData');
		act(() => {
			for (let ordinal = 1; ordinal <= 40; ordinal += 1) {
				broadcast(textDelta(ordinal));
			}
		});
		await settleFrame();

		expect(setQueryData).toHaveBeenCalledTimes(1);
		expect(result.current.events.map((event) => event.ordinal)).toEqual(
			Array.from({ length: 40 }, (_, index) => index + 1),
		);
	});

	/**
	 * The overflow cap is the only thing bounding the queue in a window that never
	 * paints: `requestAnimationFrame` does not run at all while the window is
	 * minimized or fully occluded, and an unattended turn can stream for hours
	 * behind one. Every other test here settles on a real frame and would stay
	 * green with the cap deleted, so this is the guard for it — and it fails on a
	 * cap that merely moved, not just one that vanished.
	 *
	 * The frame count is asserted too, because it is what proves the flush came
	 * from the cap: the buffer asked for exactly one frame, never got it, and
	 * wrote anyway.
	 */
	test('a window that never paints still flushes once the buffer fills', async () => {
		installBridge();
		let scheduledFrames = 0;
		vi.stubGlobal('requestAnimationFrame', () => {
			scheduledFrames += 1;
			return scheduledFrames;
		});
		vi.stubGlobal('cancelAnimationFrame', () => undefined);

		const client = createTestQueryClient();
		const { result } = renderHook(
			() => useTimelineEvents({ branchId: BRANCH_ID, sessionId: SESSION_ID }),
			{ wrapper: providerFor(client) },
		);
		await settle();

		const setQueryData = vi.spyOn(client, 'setQueryData');
		act(() => {
			for (let ordinal = 1; ordinal < BUFFER_CAP; ordinal += 1) {
				broadcast(textDelta(ordinal));
			}
		});
		await settle();
		expect(setQueryData).not.toHaveBeenCalled();

		act(() => {
			broadcast(textDelta(BUFFER_CAP));
		});
		await settle();

		expect(setQueryData).toHaveBeenCalledTimes(1);
		expect(result.current.events).toHaveLength(BUFFER_CAP);
		expect(result.current.events.at(-1)?.ordinal).toBe(BUFFER_CAP);
		expect(scheduledFrames).toBe(1);
	});

	test('an out-of-order or repeated event still lands once, in ordinal order', async () => {
		installBridge();
		const client = createTestQueryClient();
		const { result } = renderHook(
			() => useTimelineEvents({ branchId: BRANCH_ID, sessionId: SESSION_ID }),
			{ wrapper: providerFor(client) },
		);
		await settle();

		act(() => {
			broadcast(textDelta(3));
			broadcast(textDelta(1));
			broadcast(textDelta(3));
			broadcast(textDelta(2));
		});
		await settleFrame();

		expect(result.current.events.map((event) => event.ordinal)).toEqual([
			1, 2, 3,
		]);
	});

	test('events buffered when the subscription tears down are not dropped', async () => {
		installBridge();
		const client = createTestQueryClient();
		const { unmount } = renderHook(
			() => useTimelineEvents({ branchId: BRANCH_ID, sessionId: SESSION_ID }),
			{ wrapper: providerFor(client) },
		);
		await settle();

		act(() => {
			broadcast(textDelta(1));
			broadcast(textDelta(2));
			unmount();
		});

		expect(
			client.getQueryData<ListAgentSessionEventsResult>(
				ensemblrQueryKeys.agentSessionEvents(BRANCH_ID),
			)?.events,
		).toHaveLength(2);
	});
});
