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
	onClose,
}: {
	detail: string;
	listeners: Set<PiAgentEventListener>;
	metadata: PiAgentSessionMetadata;
	now: () => Date;
	onClose: () => void;
}): PiAgentAdapterSession {
	let closed = false;
	// The spawn-failure placeholder is registered in the adapter's open-session
	// set like any session; removing it on close/abort keeps it from lingering
	// there for the adapter's whole lifetime.
	const settle = (): void => {
		if (closed) {
			return;
		}
		closed = true;
		onClose();
	};
	return {
		abort: async () => {
			settle();
		},
		close: async () => {
			settle();
		},
		getMetadata: () => metadata,
		getState: async () => ({ sessionName: null }),
		id: metadata.id,
		setSessionName: async () => {
			throw new Error(
				'Cannot set session name: Pi RPC process failed to spawn.',
			);
		},
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
