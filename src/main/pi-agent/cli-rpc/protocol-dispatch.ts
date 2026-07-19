import type {
	PiAgentErrorCode,
	PiAgentEvent,
	PiAgentSessionMetadata,
	PiAgentSessionStatus,
} from '../pi-agent-types.ts';
import {
	extractMessageId,
	isMessageRole,
	normalizeLegacyMessageFrame,
	normalizeMessageEnd,
	normalizeToolExecutionFrame,
} from '../pi-wire-normalizer.ts';
import {
	extractContextUsage,
	extractMessageUpdateDeltas,
	extractTurnId,
	isSessionStatus,
} from './wire-helpers.ts';

/**
 * Dependencies the protocol dispatcher needs to interact with the surrounding
 * session. The adapter wires its closures here so this module can stay
 * focused on switch-by-frame-type behavior without owning lifecycle state.
 */
export interface ProtocolDispatchDeps {
	emit: (event: PiAgentEvent) => void;
	emitError: (
		code: PiAgentErrorCode,
		message: string,
		detail?: string,
		recoverable?: boolean,
	) => void;
	patchMetadata: (
		patch: Partial<PiAgentSessionMetadata>,
		options?: { silent?: boolean },
	) => PiAgentSessionMetadata;
	setStatus: (next: PiAgentSessionStatus) => void;
	requestContextUsage: () => void;
	now: () => Date;
	/** Pending `get_session_stats` request ids (mutated by both sides). */
	pendingStatsIds: Set<string>;
	/**
	 * Tracks turns for which we've emitted at least one text/reasoning delta.
	 * On `message_end` we strip text/reasoning parts for these turns so the
	 * authoritative final text does not duplicate the already-streamed deltas.
	 */
	streamedTurns: Set<string>;
}

/** Handles a single raw Pi RPC frame. */
type ProtocolFrameHandler = (frame: unknown) => void;

/** A raw frame narrowed to an object once its non-object shape is rejected. */
type FrameObject = Record<string, unknown>;

/**
 * Per-dispatcher mutable state that spans frames within one prompt. Kept out of
 * the deps so the adapter never has to thread it, yet shared across handlers.
 */
interface DispatchState {
	/**
	 * Whether a model/provider error has already surfaced for the current prompt.
	 * Pi auto-retries an errored `message_end` up to 3×; this collapses the
	 * retries into one diagnostic and re-arms on the next user message.
	 */
	promptErrorEmitted: boolean;
}

/**
 * Records an explicit session-id frame and moves the session into streaming.
 * @param typed - The `session` frame.
 * @param deps - Session callbacks.
 */
function handleSession(typed: FrameObject, deps: ProtocolDispatchDeps): void {
	const sessionId =
		typeof typed.sessionId === 'string' ? typed.sessionId : null;
	if (sessionId) {
		deps.patchMetadata({ sessionId });
	}
	deps.setStatus('streaming');
}

/**
 * Handles a Pi command ack (`{"type":"response",…}`): resolves a pending
 * `get_session_stats` request into a context-usage event, or surfaces a failed
 * command as a recoverable adapter error.
 * @param typed - The `response` frame.
 * @param deps - Session callbacks and the pending-stats id set.
 */
function handleResponse(typed: FrameObject, deps: ProtocolDispatchDeps): void {
	const success = typed.success !== false;
	const responseId = typeof typed.id === 'string' ? typed.id : null;
	if (responseId && deps.pendingStatsIds.has(responseId)) {
		deps.pendingStatsIds.delete(responseId);
		if (success) {
			const usage = extractContextUsage(typed.data);
			if (usage) {
				deps.emit({
					at: deps.now().toISOString(),
					type: 'context-usage',
					usage,
				});
			}
		}
		return;
	}
	if (!success) {
		deps.emitError(
			'adapter-failure',
			typeof typed.error === 'string' ? typed.error : 'Pi RPC command failed.',
			typeof typed.command === 'string'
				? `command=${typed.command}`
				: undefined,
			true,
		);
	}
}

/**
 * Streams assistant text/thinking deltas from a `message_update` frame,
 * marking the turn as streamed so its final `message_end` can drop the
 * already-streamed parts.
 * @param typed - The `message_update` frame.
 * @param deps - Session callbacks and the streamed-turn set.
 */
function handleMessageUpdate(
	typed: FrameObject,
	deps: ProtocolDispatchDeps,
): void {
	const turnId = extractTurnId(typed);
	const deltas = extractMessageUpdateDeltas(typed);
	if (deltas.length === 0) {
		return;
	}
	if (turnId) {
		deps.streamedTurns.add(turnId);
	}
	for (const delta of deltas) {
		deps.emit({
			at: deps.now().toISOString(),
			payload: delta,
			role: 'agent',
			turnId,
			type: 'message',
		});
	}
}

/**
 * Projects a final `message_end` into a persisted message event and surfaces a
 * one-shot model/provider failure. Tool-result echoes are dropped (the
 * `tool_execution_end` frame already carries the structured result).
 * @param typed - The `message_end` frame.
 * @param deps - Session callbacks and the streamed-turn set.
 * @param state - Per-prompt error-window tracking.
 */
function handleMessageEnd(
	typed: FrameObject,
	deps: ProtocolDispatchDeps,
	state: DispatchState,
): void {
	const message = (typed.message ?? {}) as FrameObject;
	if (message.role === 'toolResult') {
		return;
	}
	const wireRole = isMessageRole(message.role) ? message.role : 'agent';
	if (wireRole === 'user') {
		state.promptErrorEmitted = false;
	}
	const turnId =
		typeof typed.turnId === 'string'
			? typed.turnId
			: (extractMessageId(typed.message) ?? 'pending');
	const normalized = normalizeMessageEnd(message, wireRole);
	if (turnId !== 'pending') {
		deps.streamedTurns.delete(turnId);
	}
	deps.emit({
		at: deps.now().toISOString(),
		payload: normalized,
		role: wireRole,
		turnId,
		type: 'message',
	});
	const stopReason =
		typeof message.stopReason === 'string' ? message.stopReason : null;
	const errorMessage =
		typeof message.errorMessage === 'string' ? message.errorMessage : null;
	if (
		wireRole !== 'user' &&
		stopReason === 'error' &&
		errorMessage &&
		!state.promptErrorEmitted
	) {
		state.promptErrorEmitted = true;
		deps.emitError('adapter-failure', errorMessage, undefined, true);
	}
}

/**
 * Normalizes a tool-execution lifecycle frame into a tool-role message event.
 * @param typed - A `tool_execution_start`/`_update`/`_end` frame.
 * @param deps - Session callbacks.
 */
function handleToolExecution(
	typed: FrameObject,
	deps: ProtocolDispatchDeps,
): void {
	const turnId =
		typeof typed.turnId === 'string'
			? typed.turnId
			: typeof typed.toolCallId === 'string'
				? typed.toolCallId
				: null;
	const normalized = normalizeToolExecutionFrame(typed);
	deps.emit({
		at: deps.now().toISOString(),
		payload: normalized,
		role: 'tool',
		turnId,
		type: 'message',
	});
}

/**
 * Normalizes legacy / fallback message shapes (`tool_call`, `tool_result`,
 * `message`) into a role-tagged message event.
 * @param typed - The legacy frame.
 * @param deps - Session callbacks.
 */
function handleLegacyMessage(
	typed: FrameObject,
	deps: ProtocolDispatchDeps,
): void {
	const role = isMessageRole(typed.role)
		? typed.role
		: typed.type === 'tool_result' || typed.type === 'tool_call'
			? 'tool'
			: 'agent';
	const turnId = typeof typed.turnId === 'string' ? typed.turnId : null;
	const normalized = normalizeLegacyMessageFrame(typed, role);
	deps.emit({
		at: deps.now().toISOString(),
		payload: normalized,
		role,
		turnId,
		type: 'message',
	});
}

/**
 * Applies an explicit `status` frame, defaulting unknown values to streaming.
 * @param typed - The `status` frame.
 * @param deps - Session callbacks.
 */
function handleStatus(typed: FrameObject, deps: ProtocolDispatchDeps): void {
	const status = isSessionStatus(typed.status) ? typed.status : 'streaming';
	deps.setStatus(status);
}

/**
 * Surfaces an explicit `error` frame as a (by default recoverable) diagnostic.
 * @param typed - The `error` frame.
 * @param deps - Session callbacks.
 */
function handleError(typed: FrameObject, deps: ProtocolDispatchDeps): void {
	deps.emitError(
		'adapter-failure',
		typeof typed.message === 'string' ? typed.message : 'Pi RPC error.',
		typeof typed.detail === 'string' ? typed.detail : undefined,
		typed.recoverable !== false,
	);
}

/**
 * Records an unmodelled frame as an agent message so the timeline keeps it
 * instead of dropping it silently — future Pi versions may add frame types.
 * @param typed - The unrecognized frame.
 * @param deps - Session callbacks.
 */
function handleUnknown(typed: FrameObject, deps: ProtocolDispatchDeps): void {
	const frameType = typeof typed.type === 'string' ? typed.type : 'unknown';
	deps.emit({
		at: deps.now().toISOString(),
		payload: { frameType, kind: 'unknown', raw: typed },
		role: 'agent',
		turnId: typeof typed.turnId === 'string' ? typed.turnId : null,
		type: 'message',
	});
}

/**
 * Build the frame dispatcher that turns raw Pi RPC frames into session events,
 * routing by frame type and collapsing retried model errors into one diagnostic.
 * @param deps - Session callbacks and shared mutable turn-tracking sets.
 * @returns A handler that processes one raw frame per call.
 */
export function createProtocolDispatcher(
	deps: ProtocolDispatchDeps,
): ProtocolFrameHandler {
	const state: DispatchState = { promptErrorEmitted: false };

	return (frame: unknown): void => {
		if (!frame || typeof frame !== 'object') {
			deps.emitError(
				'adapter-failure',
				'Pi RPC frame was not a JSON object.',
				JSON.stringify(frame).slice(0, 200),
				true,
			);
			return;
		}

		const typed = frame as FrameObject;
		switch (typed.type) {
			case 'session':
				handleSession(typed, deps);
				return;
			case 'response':
				handleResponse(typed, deps);
				return;
			// A single `agent_start`…`agent_end` wraps the whole prompt; inside it Pi
			// emits one `turn_start`/`turn_end` per LLM call. The session stays BUSY
			// for the entire run, so only `agent_end` returns to idle — a per-turn
			// `turn_end` must not, or the busy state (Stop button, live timer)
			// collapses after the first tool round. Refresh the context meter on each
			// turn boundary so the token gauge tracks every call.
			case 'agent_start':
			case 'turn_start':
				deps.setStatus('streaming');
				return;
			case 'turn_end':
				deps.requestContextUsage();
				return;
			case 'agent_end':
				deps.setStatus('idle');
				deps.requestContextUsage();
				return;
			case 'message_start':
				return;
			case 'message_update':
				handleMessageUpdate(typed, deps);
				return;
			case 'message_end':
				handleMessageEnd(typed, deps, state);
				return;
			case 'tool_execution_start':
			case 'tool_execution_update':
			case 'tool_execution_end':
				handleToolExecution(typed, deps);
				return;
			case 'tool_call':
			case 'tool_result':
			case 'message':
				handleLegacyMessage(typed, deps);
				return;
			case 'status':
				handleStatus(typed, deps);
				return;
			case 'error':
				handleError(typed, deps);
				return;
			default:
				handleUnknown(typed, deps);
				return;
		}
	};
}
