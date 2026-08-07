import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

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
 * Subscribes the renderer to a single branch's event stream and returns the
 * persisted-then-live merged list in ordinal order.
 *
 * Persisted events arrive once via TanStack Query against
 * `ensemblr:list-agent-session-events`. Live events arrive through the preload
 * broadcast channel and are appended to the same query cache so the UI does
 * not need a second source of truth.
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
	isLoading: boolean;
} {
	const queryClient = useQueryClient();
	const { data, error, isPending } = useQuery(
		agentSessionEventsQuery(branchId),
	);

	useEffect(() => {
		if (!sessionId) {
			return undefined;
		}
		const unsubscribe = subscribeAgentSessionEvents((broadcast) => {
			if (broadcast.sessionId !== sessionId) {
				return;
			}
			queryClient.setQueryData<ListAgentSessionEventsResult | undefined>(
				ensemblrQueryKeys.agentSessionEvents(broadcast.event.branchId),
				(prev) => mergeBroadcast(prev, broadcast.event),
			);
		});
		return unsubscribe;
		// branchId intentionally omitted: the effect derives the cache key from the
		// broadcast's own event.branchId, so adding branchId would only cause
		// pointless re-subscribes when the branch label changes mid-stream.
	}, [queryClient, sessionId]);

	const events = useMemo<readonly AgentSessionEventWire[]>(
		() => data?.events ?? [],
		[data?.events],
	);

	return {
		error,
		events,
		isLoading: isPending,
	};
}

/**
 * Merges a broadcast event into the cached event list, keeping it ordered by ordinal and de-duplicated by id.
 * @param previous - Previously cached events result, if any
 * @param event - Newly received event to merge in
 * @returns The updated event list result
 */
function mergeBroadcast(
	previous: ListAgentSessionEventsResult | undefined,
	event: AgentSessionEventWire,
): ListAgentSessionEventsResult {
	const existing = previous?.events ?? [];
	const tail = existing[existing.length - 1];
	// Fast path: deltas stream in monotonic order, so an append-only push avoids
	// the O(n log n) sort that would otherwise run for every token.
	if (tail === undefined || event.ordinal > tail.ordinal) {
		return { events: [...existing, event] };
	}
	if (existing.some((row) => row.id === event.id)) {
		return previous ?? { events: existing };
	}
	const next = [...existing, event].sort((a, b) => a.ordinal - b.ordinal);
	return { events: next };
}
