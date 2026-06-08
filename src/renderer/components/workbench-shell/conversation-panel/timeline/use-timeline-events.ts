import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import {
	ensembleQueryKeys,
	piSessionEventsQuery,
	subscribePiSessionEvents,
} from '@/renderer/api/ensemble-queries';
import type {
	ListPiSessionEventsResult,
	PiSessionEventWire,
} from '@/shared/ipc';

/**
 * Subscribes the renderer to a single branch's event stream and returns the
 * persisted-then-live merged list in ordinal order.
 *
 * Persisted events arrive once via TanStack Query against
 * `ensemble:list-pi-session-events`. Live events arrive through the preload
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
	events: readonly PiSessionEventWire[];
	isLoading: boolean;
} {
	const queryClient = useQueryClient();
	const query = useQuery(piSessionEventsQuery(branchId));

	useEffect(() => {
		if (!sessionId) {
			return undefined;
		}
		const unsubscribe = subscribePiSessionEvents((broadcast) => {
			if (broadcast.sessionId !== sessionId) {
				return;
			}
			queryClient.setQueryData<ListPiSessionEventsResult | undefined>(
				ensembleQueryKeys.piSessionEvents(broadcast.event.branchId),
				(prev) => mergeBroadcast(prev, broadcast.event),
			);
		});
		return unsubscribe;
	}, [queryClient, sessionId]);

	const events = useMemo<readonly PiSessionEventWire[]>(
		() => query.data?.events ?? [],
		[query.data?.events],
	);

	return {
		error: query.error,
		events,
		isLoading: query.isPending,
	};
}

function mergeBroadcast(
	previous: ListPiSessionEventsResult | undefined,
	event: PiSessionEventWire,
): ListPiSessionEventsResult {
	const existing = previous?.events ?? [];
	if (existing.some((row) => row.id === event.id)) {
		return previous ?? { events: existing };
	}
	const next = [...existing, event].sort((a, b) => a.ordinal - b.ordinal);
	return { events: next };
}
