import type {
	PiAgentEvent,
	PiAgentEventListener,
	PiAgentSessionMetadata,
	PiAgentSubscription,
} from '../pi-agent-types.ts';

/**
 * Listener fan-out helper for the CLI RPC adapter. Owns:
 *  - synchronous broadcast (`emit`) — isolates a throwing listener so it can't
 *    block peers, per the adapter contract.
 *  - subscription (`attachListener`) — replays the latest metadata on the next
 *    microtask so late subscribers observe current state.
 *
 * Returned `unsubscribe` is idempotent (`Set.delete` returns false on miss).
 */
export function createListenerFanout({
	listeners,
	getMetadata,
}: {
	listeners: Set<PiAgentEventListener>;
	getMetadata: () => PiAgentSessionMetadata;
}): {
	emit: (event: PiAgentEvent) => void;
	attachListener: (listener: PiAgentEventListener) => PiAgentSubscription;
} {
	const emit = (event: PiAgentEvent): void => {
		// Snapshot before iterating so listeners that unsubscribe during fan-out
		// don't mutate the live set mid-loop.
		for (const listener of [...listeners]) {
			try {
				listener(event);
			} catch {
				// Per adapter contract: a throwing listener must not block peers.
			}
		}
	};

	const attachListener = (
		listener: PiAgentEventListener,
	): PiAgentSubscription => {
		listeners.add(listener);
		// Replay current metadata so late subscribers can render the right state.
		queueMicrotask(() => {
			if (!listeners.has(listener)) {
				return;
			}
			const metadata = getMetadata();
			try {
				listener({
					at: metadata.updatedAt,
					metadata,
					type: 'metadata',
				});
			} catch {
				// Per adapter contract: a throwing listener must not block peers.
			}
		});
		return {
			unsubscribe: () => {
				listeners.delete(listener);
			},
		};
	};

	return { attachListener, emit };
}
