import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import { useEffect } from 'react';

import {
	conciergeEventsQuery,
	ensemblrQueryKeys,
	subscribeToConciergeEvents,
} from '@/renderer/api/ensemblr';
import { mergeConciergeEvents } from '@/renderer/lib/concierge';
import {
	conciergeStreamingAtom,
	isConciergeStreamingStatus,
} from '@/renderer/state/concierge';
import type { ConciergeSessionEventWire } from '@/shared/ipc/contracts/concierge';

/** Stands in for the transcript before one is read, at a stable identity. */
const NO_EVENTS: readonly ConciergeSessionEventWire[] = [];

/**
 * Reads whether the Concierge is mid-turn back out of its own transcript.
 *
 * The status events are the only signal available — unlike a workspace chat
 * there is no session list to read a row's status from — so the last status
 * event wins, and an empty transcript reads as idle. This is what recovers the
 * state after a window reload, which `conciergeStreamingAtom` cannot do on its
 * own: it listens to live events, and a reloaded window missed the ones that
 * already landed.
 * @param events - The transcript so far.
 * @returns True while the runtime reports a turn in flight.
 */
function isStreamingFrom(
	events: readonly ConciergeSessionEventWire[],
): boolean {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const payload = events[index]?.payload;
		if (payload?.kind === 'shutdown') {
			return false;
		}
		if (payload?.kind === 'status') {
			return isConciergeStreamingStatus(payload.status);
		}
	}
	return false;
}

/**
 * Keeps one Concierge session's transcript current and reports whether it is
 * mid-turn.
 *
 * Live events are merged into the query cache rather than triggering a refetch —
 * the transcript only ever grows, so re-reading it would spend a database round
 * trip to learn what the broadcast already said. Only this session's events are
 * merged: the stream also carries the turn a child retired by a context clear
 * runs to write its memories, which belongs in that session's own transcript.
 *
 * The mid-turn answer is published into `conciergeStreamingAtom` rather than
 * returned alone, because the launcher bubble reads the same atom with the panel
 * shut, and a second local answer is how the bubble and the composer came to
 * disagree about whether a turn was running.
 * @param sessionId - Session to follow, or null before one is open.
 * @returns The transcript so far and whether a turn is in flight.
 */
export function useConciergeTranscript(sessionId: string | null): {
	events: readonly ConciergeSessionEventWire[];
	isStreaming: boolean;
} {
	const queryClient = useQueryClient();
	const eventsQuery = useQuery(conciergeEventsQuery(sessionId));
	const [isStreaming, setStreaming] = useAtom(conciergeStreamingAtom);

	// Gated on the query having landed so an empty placeholder transcript cannot
	// stomp the live value the app-root watcher already wrote.
	useEffect(() => {
		if (!eventsQuery.isSuccess) {
			return;
		}
		setStreaming(isStreamingFrom(eventsQuery.data.events));
	}, [eventsQuery.data, eventsQuery.isSuccess, setStreaming]);

	useEffect(() => {
		if (!sessionId) {
			return;
		}
		return subscribeToConciergeEvents((broadcast) => {
			if (broadcast.sessionId !== sessionId) {
				return;
			}
			queryClient.setQueryData(
				ensemblrQueryKeys.conciergeEvents(sessionId),
				(
					current: { events: readonly ConciergeSessionEventWire[] } | undefined,
				) => ({
					events: mergeConciergeEvents(current?.events ?? NO_EVENTS, [
						broadcast.event,
					]),
				}),
			);
		});
	}, [queryClient, sessionId]);

	return { events: eventsQuery.data?.events ?? NO_EVENTS, isStreaming };
}
