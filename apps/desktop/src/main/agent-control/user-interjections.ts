/**
 * Ends an agent's blocking waits when the user steers it mid-turn.
 *
 * Both runtimes hand a steer to the agent only at its next tool boundary, and a
 * blocking control op — `waitForAgents`, `runQueued`, `waitForJob`, a
 * `wait: true` spawn or follow-up — is one tool call that holds that boundary
 * for its whole window. Without this the user's message sat unread until the
 * window expired. A wait opened through {@link UserInterjections.watch} aborts
 * the moment the user steers its session, so the tool returns, the runtime
 * delivers the message, and the agent answers before it waits again. Nothing the
 * wait was watching is cancelled.
 *
 * A steer that lands while no wait is open — the model may still be writing the
 * call that will start one — arms the session instead, and the next wait it
 * opens returns at once. The boundary where the runtime delivers the message
 * disarms it: a tool result on the main thread, an answer that ends without a
 * tool call, or the turn leaving `streaming`.
 *
 * A steer that lands while the main thread is inside a sub-agent call (Claude
 * Code's `Task`) is left alone. That sub-agent reaches the control server on its
 * parent's token, so its waits look like the parent's own, yet the message goes
 * to the main thread only once the call returns — cutting the sub-agent's wait
 * would tell it to answer a message it never receives.
 */
import type { AgentPersistedEnvelope } from '../../shared/ipc/contracts/agent-message-payloads.ts';

/** One open wait's view of the interjection it may be cut short by. */
export interface WaitWatch {
	/** Aborts when the waiting turn ends or the user steers the waiting session. */
	readonly signal: AbortSignal;
	/**
	 * Whether a user steer, rather than the turn ending, is what cut the wait
	 * short. A turn that ended as well wins: there is nobody left to answer.
	 */
	interjected: () => boolean;
	/** Stops watching; call once the wait has returned, whatever ended it. */
	release: () => void;
}

/** Per-session record of the waits a user steer should end. */
export interface UserInterjections {
	/**
	 * Opens a watch over one wait by `sessionId`, consuming an armed steer — in
	 * which case the watch starts already interjected.
	 */
	watch: (sessionId: string, turnSignal: AbortSignal | undefined) => WaitWatch;
	/**
	 * Records that the user steered `sessionId`: ends every wait it has open, or
	 * arms its next one when none is. Ignored while the main thread is inside a
	 * sub-agent call.
	 */
	noteSteer: (sessionId: string) => void;
	/**
	 * Reads one runtime event of `sessionId`: tracks the sub-agent calls its main
	 * thread has open, and disarms it at the boundary that delivers a steer.
	 */
	noteEvent: (
		sessionId: string,
		envelope: AgentPersistedEnvelope | null,
	) => void;
	/** Drops what is held for a session that has ended. */
	forget: (sessionId: string) => void;
}

/**
 * Builds the registry over each session's open waits, kept as the callbacks
 * that interject them, plus its armed steer and open sub-agent calls.
 * @returns A registry with per-session waits, arms, and sub-agent calls.
 */
export function createUserInterjections(): UserInterjections {
	const openWaits = new Map<string, Set<() => void>>();
	const armed = new Set<string>();
	const subAgentCalls = new Map<string, Set<string>>();

	/**
	 * Removes one wait's interjector, dropping the session's entry once it has
	 * no open wait left.
	 * @param sessionId - Session the wait belongs to.
	 * @param interject - The wait's interjector.
	 */
	const unregister = (sessionId: string, interject: () => void): void => {
		const waits = openWaits.get(sessionId);
		waits?.delete(interject);
		if (waits?.size === 0) {
			openWaits.delete(sessionId);
		}
	};

	/**
	 * Records that the main thread of `sessionId` is inside the sub-agent call
	 * `toolCallId`, which the event just read came from.
	 * @param sessionId - Session whose main thread made the call.
	 * @param toolCallId - The main-thread call the sub-agent runs under.
	 */
	const openSubAgentCall = (sessionId: string, toolCallId: string): void => {
		const calls = subAgentCalls.get(sessionId) ?? new Set();
		calls.add(toolCallId);
		subAgentCalls.set(sessionId, calls);
	};

	/**
	 * Closes the sub-agent calls whose main-thread results just landed.
	 * @param sessionId - Session the results belong to.
	 * @param toolCallIds - Main-thread calls that returned.
	 */
	const closeSubAgentCalls = (
		sessionId: string,
		toolCallIds: readonly string[],
	): void => {
		const calls = subAgentCalls.get(sessionId);
		for (const toolCallId of toolCallIds) {
			calls?.delete(toolCallId);
		}
		if (calls?.size === 0) {
			subAgentCalls.delete(sessionId);
		}
	};

	/**
	 * Drops a session's arm and open sub-agent calls together, for a turn or a
	 * session that has ended and holds neither any more.
	 * @param sessionId - Session to clear.
	 */
	const clear = (sessionId: string): void => {
		armed.delete(sessionId);
		subAgentCalls.delete(sessionId);
	};

	return {
		watch: (sessionId, turnSignal) => {
			const controller = new AbortController();
			let steered = false;
			/** Ends this wait on the user's behalf. */
			const interject = (): void => {
				steered = true;
				controller.abort();
			};
			if (armed.delete(sessionId)) {
				interject();
			} else {
				const waits = openWaits.get(sessionId) ?? new Set();
				waits.add(interject);
				openWaits.set(sessionId, waits);
			}
			return {
				signal: turnSignal
					? AbortSignal.any([turnSignal, controller.signal])
					: controller.signal,
				interjected: () => steered && turnSignal?.aborted !== true,
				release: () => unregister(sessionId, interject),
			};
		},
		noteSteer: (sessionId) => {
			if (subAgentCalls.has(sessionId)) {
				return;
			}
			const waits = openWaits.get(sessionId);
			if (!waits) {
				armed.add(sessionId);
				return;
			}
			openWaits.delete(sessionId);
			for (const interject of waits) {
				interject();
			}
		},
		noteEvent: (sessionId, envelope) => {
			if (envelope?.kind === 'message' && envelope.parentToolCallId) {
				openSubAgentCall(sessionId, envelope.parentToolCallId);
				return;
			}
			if (envelope?.kind === 'status') {
				if (envelope.status !== 'streaming') {
					clear(sessionId);
				}
				return;
			}
			const returned = mainThreadToolResults(envelope);
			closeSubAgentCalls(sessionId, returned);
			if (returned.length > 0 || endsResponse(envelope)) {
				armed.delete(sessionId);
			}
		},
		forget: clear,
	};
}

/**
 * The calls a main-thread event reports as returned, in either shape a runtime
 * sends a tool result in.
 * @param envelope - A persisted event envelope with no sub-agent parent.
 * @returns The returned calls' ids, empty when the event carries no result.
 */
function mainThreadToolResults(
	envelope: AgentPersistedEnvelope | null,
): readonly string[] {
	if (envelope?.kind !== 'message') {
		return [];
	}
	const { payload } = envelope;
	if (payload.kind === 'tool-result') {
		return [payload.toolCallId];
	}
	if (payload.kind !== 'message') {
		return [];
	}
	return payload.parts.flatMap((part) =>
		part.kind === 'tool-result' ? [part.toolCallId] : [],
	);
}

/**
 * Whether a main-thread event is an answer that ended without a tool call —
 * where Pi flushes the steering it holds before its next model call.
 * @param envelope - A persisted event envelope with no sub-agent parent.
 * @returns True for such an answer.
 */
function endsResponse(envelope: AgentPersistedEnvelope | null): boolean {
	return (
		envelope?.kind === 'message' &&
		envelope.payload.kind === 'message' &&
		envelope.payload.endsResponse === true
	);
}
