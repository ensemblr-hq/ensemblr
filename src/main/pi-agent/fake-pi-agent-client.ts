import type {
	PiAgentAdapter,
	PiAgentAdapterCreateSessionInput,
	PiAgentAdapterSession,
} from './pi-agent-adapter.ts';
import type {
	PiAgentEvent,
	PiAgentEventListener,
	PiAgentSessionId,
	PiAgentSessionMetadata,
	PiAgentSessionStatus,
	PiAgentShutdownReason,
	PiAgentSubmitAcknowledgement,
	PiAgentSubmitRequest,
	PiAgentSubscription,
} from './pi-agent-types.ts';

/**
 * Per-session controller exposed by the fake adapter so tests can drive
 * status changes, message frames, and errors without touching real I/O.
 */
export interface FakePiAgentAdapterSessionController {
	emit: (event: PiAgentEvent) => void;
	getMetadata: () => PiAgentSessionMetadata;
	getRequests: () => readonly PiAgentSubmitRequest[];
	getStatus: () => PiAgentSessionStatus;
	id: PiAgentSessionId;
	listenerCount: () => number;
	setSessionId: (sessionId: string | null) => void;
	setStatus: (status: PiAgentSessionStatus) => void;
}

/** Aggregate controller exposed alongside the fake adapter. */
export interface FakePiAgentAdapterController {
	adapter: PiAgentAdapter;
	getOpenSessions: () => readonly FakePiAgentAdapterSessionController[];
	getShutdownCount: () => number;
}

/** Options for `createFakePiAgentAdapter`. */
export interface CreateFakePiAgentAdapterOptions {
	now?: () => Date;
	turnIdFactory?: () => string;
}

/**
 * Builds an in-memory `PiAgentAdapter` for unit tests. Returns both the
 * adapter and a controller that lets tests assert and drive session state.
 * @param options - Deterministic overrides for clock and turn IDs.
 * @returns A {@link FakePiAgentAdapterController}.
 */
export function createFakePiAgentAdapter(
	options: CreateFakePiAgentAdapterOptions = {},
): FakePiAgentAdapterController {
	const now = options.now ?? (() => new Date());
	let turnCounter = 0;
	const turnIdFactory =
		options.turnIdFactory ?? (() => `turn-${++turnCounter}`);

	const openSessions = new Map<PiAgentSessionId, FakeAdapterSessionEntry>();
	let shutdownCount = 0;

	const adapter: PiAgentAdapter = {
		createSession: async (input) => {
			const entry = createSessionEntry({ input, now, turnIdFactory });
			openSessions.set(entry.session.id, entry);
			entry.onClosed = () => openSessions.delete(entry.session.id);
			return entry.session;
		},
		shutdown: async () => {
			shutdownCount += 1;
			const entries = [...openSessions.values()];
			openSessions.clear();
			await Promise.all(entries.map((entry) => entry.session.close()));
		},
	};

	return {
		adapter,
		getOpenSessions: () =>
			[...openSessions.values()].map((entry) => entry.controller),
		getShutdownCount: () => shutdownCount,
	};
}

interface FakeAdapterSessionEntry {
	controller: FakePiAgentAdapterSessionController;
	onClosed: () => void;
	session: PiAgentAdapterSession;
}

/**
 * Constructs a single fake adapter session with mutable metadata, an event
 * fan-out, and a recorded list of submitted requests.
 */
function createSessionEntry({
	input,
	now,
	turnIdFactory,
}: {
	input: PiAgentAdapterCreateSessionInput;
	now: () => Date;
	turnIdFactory: () => string;
}): FakeAdapterSessionEntry {
	const listeners = new Set<PiAgentEventListener>();
	const requests: PiAgentSubmitRequest[] = [];
	let metadata: PiAgentSessionMetadata = { ...input.metadata };
	let closed = false;

	const emit = (event: PiAgentEvent): void => {
		for (const listener of [...listeners]) {
			try {
				listener(event);
			} catch {
				// Match the adapter contract: a throwing listener must not block
				// peers. Exceptions are swallowed so the fan-out is robust.
			}
		}
	};

	const updateMetadata = (
		patch: Partial<PiAgentSessionMetadata>,
	): PiAgentSessionMetadata => {
		metadata = {
			...metadata,
			...patch,
			updatedAt: now().toISOString(),
		};
		return metadata;
	};

	const close = async (reason: PiAgentShutdownReason): Promise<void> => {
		if (closed) {
			return;
		}
		closed = true;
		updateMetadata({ status: 'closed' });
		emit({
			at: now().toISOString(),
			reason,
			type: 'shutdown',
		});
		listeners.clear();
		entry.onClosed();
	};

	const session: PiAgentAdapterSession = {
		abort: (_reason) => close('aborted'),
		close: () => close('manual'),
		getMetadata: () => metadata,
		id: input.metadata.id,
		subscribe: (listener) => {
			listeners.add(listener);
			const subscription: PiAgentSubscription = {
				unsubscribe: () => {
					listeners.delete(listener);
				},
			};
			return subscription;
		},
		submit: async (request) => {
			if (closed) {
				throw new Error('Fake session is closed.');
			}
			requests.push(request);
			const acknowledgement: PiAgentSubmitAcknowledgement = {
				acceptedAt: now().toISOString(),
				turnId: turnIdFactory(),
			};
			updateMetadata({ status: 'streaming' });
			emit({
				at: acknowledgement.acceptedAt,
				payload: { kind: 'prompt', prompt: request.prompt },
				role: 'user',
				turnId: acknowledgement.turnId,
				type: 'message',
			});
			return acknowledgement;
		},
	};

	const controller: FakePiAgentAdapterSessionController = {
		emit: (event) => emit(event),
		getMetadata: () => metadata,
		getRequests: () => requests.slice(),
		getStatus: () => metadata.status,
		id: session.id,
		listenerCount: () => listeners.size,
		setSessionId: (sessionId) => {
			updateMetadata({ sessionId });
		},
		setStatus: (status) => {
			const previous = metadata.status;
			updateMetadata({ status });
			emit({
				at: now().toISOString(),
				previous,
				status,
				type: 'status',
			});
		},
	};

	const entry: FakeAdapterSessionEntry = {
		controller,
		onClosed: () => {
			// Replaced after registration so `close` can notify the adapter.
		},
		session,
	};

	return entry;
}
