import type {
	AgentSessionEventWire as AgentEventFrame,
	AgentPersistedEnvelope,
	AgentWireMessagePayload,
} from '@/shared/ipc/contracts/agent-session';

/** The `message` envelope variant, which is the only one that carries a delta. */
type MessageEnvelope = Extract<AgentPersistedEnvelope, { kind: 'message' }>;

/** The streaming text and reasoning payload variants. */
type DeltaPayload = Extract<
	AgentWireMessagePayload,
	{ kind: 'reasoning-delta' | 'text-delta' }
>;

/** A row read as a streaming delta: the envelope it travels in and the chunk it carries. */
interface StreamingDelta {
	envelope: MessageEnvelope;
	payload: DeltaPayload;
}

/**
 * Reads a row as a streaming text or reasoning delta.
 * @param event - The row to inspect
 * @returns The delta the row carries, or null when it is anything else
 */
function readStreamingDelta(event: AgentEventFrame): StreamingDelta | null {
	const envelope = event.payload;
	if (event.stream === 'stderr' || envelope?.kind !== 'message') {
		return null;
	}
	const payload = envelope.payload;
	return payload.kind === 'text-delta' || payload.kind === 'reasoning-delta'
		? { envelope, payload }
		: null;
}

/**
 * Whether a row is a streaming text or reasoning delta, the one kind of row
 * whose fold cannot rewrite anything already folded.
 * @param event - The row to inspect
 * @returns True when the row carries a streaming delta
 */
export function isStreamingDeltaRow(event: AgentEventFrame): boolean {
	return readStreamingDelta(event) !== null;
}

/**
 * Names the stream a row's chunk belongs to: the kind of text, the thread, the
 * turn and the branch. Only a row that actually carries text has one, because an
 * empty chunk paints nothing and so cannot be told apart from the row that opens
 * a group.
 * @param event - The row to inspect
 * @returns The stream's key, or null when the row is not a delta carrying text
 */
function streamKeyOf(event: AgentEventFrame): string | null {
	const delta = readStreamingDelta(event);
	if (!delta || delta.payload.text === '') {
		return null;
	}
	return JSON.stringify([
		event.branchId,
		event.turnId,
		event.eventType,
		delta.payload.kind,
		delta.envelope.role,
		delta.envelope.parentToolCallId || null,
	]);
}

/**
 * Whether two rows carry adjacent chunks of one stream.
 * @param previous - The earlier row
 * @param next - The row that follows it
 * @returns True when folding `next` into `previous` cannot move it past anything
 */
function continuesStream(
	previous: AgentEventFrame,
	next: AgentEventFrame,
): boolean {
	const key = streamKeyOf(previous);
	return key !== null && key === streamKeyOf(next);
}

/**
 * Builds the row that stands for `tail` followed by `next`: everything about
 * `next` — its id, ordinal and time — carrying both rows' text.
 * @param tail - The accumulated row so far
 * @param next - The row being folded in
 * @returns A new row; neither input is modified
 */
function accumulate(
	tail: AgentEventFrame,
	next: AgentEventFrame,
): AgentEventFrame {
	const before = readStreamingDelta(tail);
	const after = readStreamingDelta(next);
	if (!before || !after) {
		return next;
	}
	return {
		...next,
		payload: {
			...after.envelope,
			payload: {
				...after.payload,
				text: before.payload.text + after.payload.text,
			},
		},
	};
}

/**
 * Appends in-order live events to the cached list, folding a run of streaming
 * deltas into a bounded shape: the run's first row, untouched, and one tail row
 * that accumulates every chunk after it.
 *
 * Keeping the first row apart is what keeps the projection identical to a
 * per-chunk fold: the message a run opens takes its id and start time from that
 * row, while its end time and last ordinal come from the newest chunk, which the
 * tail carries. A stream of any length therefore costs two cached rows, and only
 * the tail changes as it grows.
 * @param existing - The cached events, in ordinal order
 * @param incoming - Events that arrive strictly after `existing`, in ordinal order
 * @returns The extended list; neither input is modified
 */
export function appendLiveEvents(
	existing: readonly AgentEventFrame[],
	incoming: readonly AgentEventFrame[],
): AgentEventFrame[] {
	const rows = [...existing];
	for (const event of incoming) {
		const tail = rows.at(-1);
		const previous = rows.at(-2);
		if (
			tail &&
			previous &&
			continuesStream(previous, tail) &&
			continuesStream(tail, event)
		) {
			rows[rows.length - 1] = accumulate(tail, event);
		} else {
			rows.push(event);
		}
	}
	return rows;
}
