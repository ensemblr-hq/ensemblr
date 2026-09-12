// @vitest-environment happy-dom

/**
 * The persisted read is a bounded window onto a branch's newest events, because
 * an unbounded read of a long branch blocks the main process and ships megabytes
 * through one reply. The renderer therefore has to be able to ask for more, and
 * it has to keep knowing that there *is* more once a turn starts streaming —
 * the live-broadcast fold writes the same cache entry the window came in on, so
 * dropping the cursor there retires the control on the first token.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { useTimelineEvents } from '@/renderer/hooks/workbench-shell/timeline/use-timeline-events';
import type {
	AgentSessionEventBroadcast,
	AgentSessionEventWire,
	ListAgentSessionEventsRequest,
	ListAgentSessionEventsResult,
} from '@/shared/ipc/contracts/agent-session';

import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from '../support/dom';

const BRANCH_ID = 'branch-1';
const SESSION_ID = 'session-1';

/** Broadcast listeners the stubbed bridge has handed out. */
let listeners: ((broadcast: AgentSessionEventBroadcast) => void)[] = [];

/**
 * Builds a persisted event at one ordinal, carrying the smallest payload the
 * projector accepts.
 * @param ordinal - The event's position in the branch
 * @returns One wire event
 */
function eventAt(ordinal: number): AgentSessionEventWire {
	return {
		at: new Date(ordinal * 1000).toISOString(),
		branchId: BRANCH_ID,
		id: `event-${ordinal}`,
		ordinal,
		payload: { kind: 'text', text: `line ${ordinal}` },
		sessionId: SESSION_ID,
		stream: 'stdout',
		type: 'message',
	} as unknown as AgentSessionEventWire;
}

/**
 * Installs a bridge answering the newest window, then one page further back.
 * @param pages - Results keyed by the `beforeOrdinal` asked for, `'newest'` for none
 * @returns The spy the hook's reads land on
 */
function installBridge(
	pages: Record<string, ListAgentSessionEventsResult>,
): ReturnType<typeof vi.fn> {
	listeners = [];
	const listAgentSessionEvents = vi.fn(
		async (request: ListAgentSessionEventsRequest) =>
			pages[String(request.beforeOrdinal ?? 'newest')] ?? { events: [] },
	);
	installEnsemblrApi({
		listAgentSessionEvents,
		onAgentSessionEvent: (
			listener: (broadcast: AgentSessionEventBroadcast) => void,
		) => {
			listeners.push(listener);
			return () => undefined;
		},
	});
	return listAgentSessionEvents;
}

/** Waits for the animation frame the broadcast buffer folds its batch on. */
async function settleFrame(): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => {
			requestAnimationFrame(() => resolve(undefined));
		});
	});
}

/** Renders the hook under a fresh query client. */
function renderTimelineEvents() {
	const client = createTestQueryClient();
	return renderHook(
		() => useTimelineEvents({ branchId: BRANCH_ID, sessionId: SESSION_ID }),
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={client}>{children}</QueryClientProvider>
			),
		},
	);
}

afterEach(() => {
	clearEnsemblrApi();
	listeners = [];
});

describe('paging a branch further back', () => {
	test('reports that the window stopped short of the branch start', async () => {
		installBridge({
			newest: { events: [eventAt(10), eventAt(11)], hasOlder: true },
		});
		const { result } = renderTimelineEvents();

		await waitFor(() => {
			expect(result.current.hasOlder).toBe(true);
		});
	});

	test('pages back from the oldest ordinal it holds and prepends the page', async () => {
		const reads = installBridge({
			'10': { events: [eventAt(8), eventAt(9)], hasOlder: false },
			newest: { events: [eventAt(10), eventAt(11)], hasOlder: true },
		});
		const { result } = renderTimelineEvents();
		await waitFor(() => {
			expect(result.current.events).toHaveLength(2);
		});

		act(() => {
			result.current.loadOlder();
		});

		await waitFor(() => {
			expect(result.current.events.map((row) => row.ordinal)).toEqual([
				8, 9, 10, 11,
			]);
		});
		expect(reads).toHaveBeenCalledWith({
			beforeOrdinal: 10,
			branchId: BRANCH_ID,
		});
		expect(result.current.hasOlder).toBe(false);
	});

	test('a streamed event does not retire the scroll-back control', async () => {
		installBridge({
			newest: { events: [eventAt(10)], hasOlder: true },
		});
		const { result } = renderTimelineEvents();
		await waitFor(() => {
			expect(result.current.hasOlder).toBe(true);
		});

		for (const listener of listeners) {
			listener({
				event: eventAt(11),
				sessionId: SESSION_ID,
			} as unknown as AgentSessionEventBroadcast);
		}
		await settleFrame();

		await waitFor(() => {
			expect(result.current.events).toHaveLength(2);
		});
		expect(result.current.hasOlder).toBe(true);
	});

	test('re-reading a page it already holds adds nothing', async () => {
		installBridge({
			'10': { events: [eventAt(10)], hasOlder: false },
			newest: { events: [eventAt(10), eventAt(11)], hasOlder: true },
		});
		const { result } = renderTimelineEvents();
		await waitFor(() => {
			expect(result.current.events).toHaveLength(2);
		});

		act(() => {
			result.current.loadOlder();
		});

		await waitFor(() => {
			expect(result.current.hasOlder).toBe(false);
		});
		expect(result.current.events).toHaveLength(2);
	});
});
