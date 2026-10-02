import type {
	AgentAdapter,
	AgentAdapterCreateSessionInput,
	AgentAdapterSession,
} from './agent-adapter.ts';
import type {
	AgentEvent,
	AgentEventListener,
	AgentSessionId,
	AgentSessionMetadata,
	AgentSessionRequest,
	AgentSessionStatus,
	AgentShutdownReason,
	AgentSubmitAcknowledgement,
	AgentSubmitRequest,
	AgentSubscription,
} from './agent-types.ts';

/**
 * Per-session controller exposed by the fake adapter so tests can drive
 * status changes, message frames, and errors without touching real I/O.
 */
export interface FakeAgentAdapterSessionController {
	emit: (event: AgentEvent) => void;
	getMetadata: () => AgentSessionMetadata;
	getRequests: () => readonly AgentSubmitRequest[];
	/** The provider-neutral session request the client handed the adapter. */
	getSessionRequest: () => AgentSessionRequest;
	getStatus: () => AgentSessionStatus;
	id: AgentSessionId;
	listenerCount: () => number;
	setSessionId: (sessionId: string | null) => void;
	setSessionName: (sessionName: string | null) => void;
	setStatus: (status: AgentSessionStatus) => void;
}

/** Aggregate controller exposed alongside the fake adapter. */
export interface FakeAgentAdapterController {
	adapter: AgentAdapter;
	getOpenSessions: () => readonly FakeAgentAdapterSessionController[];
	getShutdownCount: () => number;
}

/**
 * Builds an in-memory `AgentAdapter` for unit tests. Returns both the
 * adapter and a controller that lets tests assert and drive session state.
 * @param options - Deterministic overrides for clock and turn IDs.
 * @returns A {@link FakeAgentAdapterController}.
 */
export function createFakeAgentAdapter(
	options: { now?: () => Date; turnIdFactory?: () => string } = {},
): FakeAgentAdapterController {
	const now = options.now ?? (() => new Date());
	let turnCounter = 0;
	const turnIdFactory =
		options.turnIdFactory ?? (() => `turn-${++turnCounter}`);

	const openSessions = new Map<AgentSessionId, FakeAdapterSessionEntry>();
	let shutdownCount = 0;

	const adapter: AgentAdapter = {
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

/** A single open fake-adapter session: its public session handle, test controller, and close callback. */
interface FakeAdapterSessionEntry {
	controller: FakeAgentAdapterSessionController;
	onClosed: () => void;
	session: AgentAdapterSession;
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
	input: AgentAdapterCreateSessionInput;
	now: () => Date;
	turnIdFactory: () => string;
}): FakeAdapterSessionEntry {
	const listeners = new Set<AgentEventListener>();
	const requests: AgentSubmitRequest[] = [];
	let metadata: AgentSessionMetadata = { ...input.metadata };
	let closed = false;
	let sessionName: string | null = null;

	const emit = (event: AgentEvent): void => {
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
		patch: Partial<AgentSessionMetadata>,
	): AgentSessionMetadata => {
		metadata = {
			...metadata,
			...patch,
			updatedAt: now().toISOString(),
		};
		return metadata;
	};

	const close = async (reason: AgentShutdownReason): Promise<void> => {
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

	const session: AgentAdapterSession = {
		abort: (_reason) => close('aborted'),
		close: () => close('manual'),
		getMetadata: () => metadata,
		getState: async () => ({ sessionName }),
		id: input.metadata.id,
		setSessionName: async (name) => {
			sessionName = name.trim() || null;
		},
		subscribe: (listener) => {
			listeners.add(listener);
			const subscription: AgentSubscription = {
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
			const acknowledgement: AgentSubmitAcknowledgement = {
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

	const controller: FakeAgentAdapterSessionController = {
		emit: (event) => emit(event),
		getMetadata: () => metadata,
		getRequests: () => requests.slice(),
		getSessionRequest: () => input.request,
		getStatus: () => metadata.status,
		id: session.id,
		listenerCount: () => listeners.size,
		setSessionId: (sessionId) => {
			updateMetadata({ sessionId });
		},
		setSessionName: (name) => {
			sessionName = name;
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
