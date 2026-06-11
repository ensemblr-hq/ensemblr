import type {
	PiAgentAdapterSession,
	// re-used via metadata snapshot
} from '../pi-agent-adapter.ts';
import type {
	PiAgentEventListener,
	PiAgentSessionMetadata,
} from '../pi-agent-types.ts';

/**
 * Builds the placeholder `PiAgentAdapterSession` returned when `spawn` throws
 * synchronously. The placeholder honors the adapter contract: `subscribe`
 * replays a `spawn-error` followed by a `crashed` shutdown to late
 * subscribers so they observe the terminal state.
 *
 * Listener fan-out exceptions are intentionally swallowed — per the adapter
 * contract a throwing listener must not block its peers.
 */
export function createSpawnFailureSession({
	detail,
	listeners,
	metadata,
	now,
}: {
	detail: string;
	listeners: Set<PiAgentEventListener>;
	metadata: PiAgentSessionMetadata;
	now: () => Date;
}): PiAgentAdapterSession {
	return {
		abort: async () => undefined,
		close: async () => undefined,
		getMetadata: () => metadata,
		id: metadata.id,
		subscribe: (listener) => {
			listeners.add(listener);
			queueMicrotask(() => {
				if (!listeners.has(listener)) {
					return;
				}
				try {
					listener({
						at: now().toISOString(),
						error: {
							code: 'spawn-error',
							detail,
							message: 'Failed to spawn the Pi RPC process.',
							recoverable: false,
						},
						type: 'error',
					});
					listener({
						at: now().toISOString(),
						reason: 'crashed',
						type: 'shutdown',
					});
				} catch {
					// Fan-out contract: a throwing listener must not block peers.
				}
			});
			return {
				unsubscribe: () => {
					listeners.delete(listener);
				},
			};
		},
		submit: async () => {
			throw new Error('Cannot submit: Pi RPC process failed to spawn.');
		},
	};
}
