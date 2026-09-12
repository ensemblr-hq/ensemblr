import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getEnsemblrApiOrNull } from '@/renderer/api/ensemblr';
import {
	agentSessionEventsQuery,
	ensemblrQueryKeys,
	subscribeAgentSessionEvents,
} from '@/renderer/api/ensemblr-queries';
import type {
	AgentSessionEventWire,
	ListAgentSessionEventsResult,
} from '@/shared/ipc/contracts/agent-session';

/**
 * How many events may bank before the buffer stops waiting for a paint.
 * `requestAnimationFrame` does not fire at all while the window is minimized or
 * fully occluded, and an unattended turn can stream for hours behind one — so
 * the cap is what keeps a hidden window's queue from growing with the turn.
 */
const MAX_BUFFERED_EVENTS = 512;

/**
 * Subscribes the renderer to a single branch's event stream and returns the
 * persisted-then-live merged list in ordinal order.
 *
 * Persisted events arrive once via TanStack Query against
 * `ensemblr:list-agent-session-events`. Live events arrive through the preload
 * broadcast channel and are appended to the same query cache so the UI does
 * not need a second source of truth.
 *
 * The persisted read is a bounded *window* onto the newest events rather than
 * the whole branch — an unbounded read of a long branch blocks the main process
 * and ships megabytes through one reply. `hasOlder` says the window stopped
 * short of the branch's start, and `loadOlder` pages one window further back
 * from the oldest ordinal currently held.
 */
export function useTimelineEvents({
	branchId,
	sessionId,
}: {
	branchId: string;
	sessionId: string | null;
}): {
	error: unknown;
	events: readonly AgentSessionEventWire[];
	hasOlder: boolean;
	isLoading: boolean;
	isLoadingOlder: boolean;
	loadOlder: () => void;
} {
	const queryClient = useQueryClient();
	const { data, error, isPending } = useQuery(
		agentSessionEventsQuery(branchId),
	);
	const [isLoadingOlder, setIsLoadingOlder] = useState(false);

	useEffect(() => {
		if (!sessionId) {
			return undefined;
		}
		const buffer = createBroadcastBuffer(queryClient);
		const unsubscribe = subscribeAgentSessionEvents((broadcast) => {
			if (broadcast.sessionId !== sessionId) {
				return;
			}
			buffer.push(broadcast.event);
		});
		return () => {
			unsubscribe();
			buffer.flush();
		};
		// branchId intentionally omitted: the effect derives the cache key from the
		// broadcast's own event.branchId, so adding branchId would only cause
		// pointless re-subscribes when the branch label changes mid-stream.
	}, [queryClient, sessionId]);

	const events = useMemo<readonly AgentSessionEventWire[]>(
		() => data?.events ?? [],
		[data?.events],
	);

	const oldestOrdinal = events[0]?.ordinal;
	const loadOlder = useCallback(() => {
		const api = getEnsemblrApiOrNull();
		if (!api || oldestOrdinal === undefined) {
			return;
		}
		setIsLoadingOlder(true);
		void api
			.listAgentSessionEvents({ beforeOrdinal: oldestOrdinal, branchId })
			// oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then)
			.then((older) => {
				queryClient.setQueryData<ListAgentSessionEventsResult | undefined>(
					ensemblrQueryKeys.agentSessionEvents(branchId),
					(previous) => prependOlder(previous, older),
				);
			})
			// oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then), eslint-plugin-promise(prefer-await-to-callbacks)
			.catch((cause) => {
				console.error('Failed to load earlier timeline events:', cause);
			})
			// oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then)
			.finally(() => {
				setIsLoadingOlder(false);
			});
	}, [branchId, oldestOrdinal, queryClient]);

	return {
		error,
		events,
		hasOlder: data?.hasOlder === true,
		isLoading: isPending,
		isLoadingOlder,
		loadOlder,
	};
}

/**
 * Folds a page of older events onto the front of the cached window.
 *
 * `hasOlder` is taken from the page that was just read, because that is the only
 * answer that describes where the window now starts; keeping the previous value
 * would leave the control offering a page that no longer exists.
 * @param previous - Previously cached events result, if any
 * @param older - The page read with a `beforeOrdinal` cursor
 * @returns The widened window
 */
function prependOlder(
	previous: ListAgentSessionEventsResult | undefined,
	older: ListAgentSessionEventsResult,
): ListAgentSessionEventsResult {
	const existing = previous?.events ?? [];
	const knownIds = new Set(existing.map((row) => row.id));
	const fresh = older.events.filter((row) => !knownIds.has(row.id));
	return {
		events: fresh.length > 0 ? [...fresh, ...existing] : existing,
		hasOlder: older.hasOlder === true,
	};
}

/**
 * Collects broadcast events and folds them into the query cache at most once per
 * painted frame instead of once per event.
 *
 * A runtime broadcasts one event per streamed token, and every cache write wakes
 * every observer of that branch — so an unbuffered subscription commits React
 * once per token and pins the compositor at the display's refresh rate for the
 * whole turn. Coalescing on `requestAnimationFrame` caps that at what the screen
 * can actually show, collapses the per-token copy of the event array into one
 * copy per frame, and back-pressures on its own, since a saturated renderer
 * simply gets fewer frames to flush on.
 * @param queryClient - Cache each batch is folded into.
 * @returns `push` for an incoming event, and `flush` to drain what is queued.
 */
function createBroadcastBuffer(queryClient: QueryClient): {
	flush: () => void;
	push: (event: AgentSessionEventWire) => void;
} {
	const queuedByBranch = new Map<string, AgentSessionEventWire[]>();
	let queuedCount = 0;
	let frame: number | null = null;

	const flush = (): void => {
		if (frame !== null) {
			cancelAnimationFrame(frame);
			frame = null;
		}
		queuedCount = 0;
		for (const [branchId, events] of queuedByBranch) {
			queryClient.setQueryData<ListAgentSessionEventsResult | undefined>(
				ensemblrQueryKeys.agentSessionEvents(branchId),
				(previous) => mergeBroadcasts(previous, events),
			);
		}
		queuedByBranch.clear();
	};

	return {
		flush,
		push: (event) => {
			const queued = queuedByBranch.get(event.branchId);
			if (queued) {
				queued.push(event);
			} else {
				queuedByBranch.set(event.branchId, [event]);
			}
			queuedCount += 1;
			if (queuedCount >= MAX_BUFFERED_EVENTS) {
				flush();
				return;
			}
			frame ??= requestAnimationFrame(flush);
		},
	};
}

/**
 * Merges a frame's worth of broadcast events into the cached event list, keeping
 * it ordered by ordinal and de-duplicated by id.
 *
 * `hasOlder` is carried through untouched: it describes where the *start* of the
 * window sits, and appending live events at the end cannot move that. Dropping
 * it would retire the scroll-back control on the first streamed token.
 * @param previous - Previously cached events result, if any
 * @param incoming - Newly received events, in the order they were broadcast
 * @returns The updated event list result, or the previous one when nothing was new
 */
function mergeBroadcasts(
	previous: ListAgentSessionEventsResult | undefined,
	incoming: readonly AgentSessionEventWire[],
): ListAgentSessionEventsResult {
	const existing = previous?.events ?? [];
	const hasOlder = previous?.hasOlder === true ? { hasOlder: true } : {};
	// Fast path: deltas stream in monotonic order, so one append covers the whole
	// batch and skips both the id set and the O(n log n) sort.
	if (incoming.length > 0 && extendsInOrder(existing, incoming)) {
		return { events: [...existing, ...incoming], ...hasOlder };
	}
	const merged = sortedUnion(existing, incoming);
	return merged
		? { events: merged, ...hasOlder }
		: (previous ?? { events: existing });
}

/**
 * Adds whichever incoming events the cached list does not already carry and
 * restores ordinal order.
 * @param existing - The events already cached, in ordinal order
 * @param incoming - The events that arrived since the last flush
 * @returns The merged list, or null when every incoming event was already known
 */
function sortedUnion(
	existing: readonly AgentSessionEventWire[],
	incoming: readonly AgentSessionEventWire[],
): AgentSessionEventWire[] | null {
	const seenIds = new Set(existing.map((row) => row.id));
	const merged = [...existing];
	for (const event of incoming) {
		if (!seenIds.has(event.id)) {
			seenIds.add(event.id);
			merged.push(event);
		}
	}
	return merged.length === existing.length
		? null
		: merged.sort((a, b) => a.ordinal - b.ordinal);
}

/**
 * Whether a batch continues the cached list in ordinal order, so appending it
 * whole preserves the ordering the timeline reads.
 * @param existing - The events already cached, in ordinal order
 * @param incoming - The events that arrived since the last flush
 * @returns True when every incoming ordinal is strictly greater than the one before it
 */
function extendsInOrder(
	existing: readonly AgentSessionEventWire[],
	incoming: readonly AgentSessionEventWire[],
): boolean {
	let previousOrdinal = existing[existing.length - 1]?.ordinal ?? -Infinity;
	for (const event of incoming) {
		if (event.ordinal <= previousOrdinal) {
			return false;
		}
		previousOrdinal = event.ordinal;
	}
	return true;
}
