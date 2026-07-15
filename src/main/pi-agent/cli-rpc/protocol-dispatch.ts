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

/**
 * Build the frame dispatcher that turns raw Pi RPC frames into session events,
 * routing by frame type and collapsing retried model errors into one diagnostic.
 * @param deps - Session callbacks and shared mutable turn-tracking sets.
 * @returns A handler that processes one raw frame per call.
 */
export function createProtocolDispatcher(
	deps: ProtocolDispatchDeps,
): ProtocolFrameHandler {
	const {
		emit,
		emitError,
		patchMetadata,
		setStatus,
		requestContextUsage,
		now,
		pendingStatsIds,
		streamedTurns,
	} = deps;

	// Pi reports model/provider failures as an assistant `message_end` carrying
	// `stopReason: "error"` + `errorMessage` (and auto-retries up to 3×, each a
	// fresh errored message_end). Track whether we've surfaced an error for the
	// current prompt so the retries collapse into a single diagnostic line. Reset
	// on each new user message_end.
	let promptErrorEmitted = false;

	return (frame: unknown): void => {
		if (!frame || typeof frame !== 'object') {
			emitError(
				'adapter-failure',
				'Pi RPC frame was not a JSON object.',
				JSON.stringify(frame).slice(0, 200),
				true,
			);
			return;
		}

		const typed = frame as Record<string, unknown>;
		switch (typed.type) {
			// `session` (legacy/future) — explicit session id frame.
			case 'session': {
				const sessionId =
					typeof typed.sessionId === 'string' ? typed.sessionId : null;
				if (sessionId) {
					patchMetadata({ sessionId });
				}
				setStatus('streaming');
				return;
			}
			// Pi command ack: `{"type":"response","command":"prompt","success":bool}`.
			case 'response': {
				const success = typed.success !== false;
				const responseId = typeof typed.id === 'string' ? typed.id : null;
				if (responseId && pendingStatsIds.has(responseId)) {
					pendingStatsIds.delete(responseId);
					if (success) {
						const usage = extractContextUsage(typed.data);
						if (usage) {
							emit({
								at: now().toISOString(),
								type: 'context-usage',
								usage,
							});
						}
					}
					return;
				}
				if (!success) {
					emitError(
						'adapter-failure',
						typeof typed.error === 'string'
							? typed.error
							: 'Pi RPC command failed.',
						typeof typed.command === 'string'
							? `command=${typed.command}`
							: undefined,
						true,
					);
				}
				return;
			}
			// Pi lifecycle: a single `agent_start` … `agent_end` wraps the whole
			// prompt, and inside it Pi emits one `turn_start`/`turn_end` pair per
			// LLM call (one per tool-loop iteration — see the multi-tool captures).
			// The session is BUSY for the entire agent run, so only `agent_end`
			// returns to idle. A per-turn `turn_end` must NOT, or the busy state
			// collapses after the first tool round and takes the composer Stop
			// button and the live turn timer down with it. Refresh the context
			// meter on every turn boundary so the token gauge tracks each call.
			case 'agent_start':
			case 'turn_start':
				setStatus('streaming');
				return;
			case 'turn_end':
				requestContextUsage();
				return;
			case 'agent_end':
				setStatus('idle');
				requestContextUsage();
				return;
			// Pi message lifecycle.
			//   message_start: new assistant message begins — record turnId only.
			//   message_update: carries `assistantMessageEvent` text/thinking deltas.
			//     Parsed and emitted as `text-delta`/`reasoning-delta` payloads
			//     so the timeline can stream tokens in real time.
			//   message_end: full `message` object with role + content[] blocks.
			case 'message_start':
				return;
			case 'message_update': {
				const turnId = extractTurnId(typed);
				const deltas = extractMessageUpdateDeltas(typed);
				if (deltas.length === 0) {
					return;
				}
				if (turnId) {
					streamedTurns.add(turnId);
				}
				for (const delta of deltas) {
					emit({
						at: now().toISOString(),
						payload: delta,
						role: 'agent',
						turnId,
						type: 'message',
					});
				}
				return;
			}
			case 'message_end': {
				const message = (typed.message ?? {}) as Record<string, unknown>;
				// Pi mirrors every tool result as a `message_end` with
				// role "toolResult" whose content is the raw output text. The
				// `tool_execution_end` frame already carries the same result as a
				// structured tool-result payload, so persisting this echo would
				// render the output twice — once in the tool card and again as a
				// bare text dump in the transcript.
				if (message.role === 'toolResult') {
					return;
				}
				const wireRole = isMessageRole(message.role) ? message.role : 'agent';
				// A new user prompt opens a fresh error window — re-arm so its
				// turn's first failure surfaces (retries within the turn stay muted).
				if (wireRole === 'user') {
					promptErrorEmitted = false;
				}
				const turnId =
					typeof typed.turnId === 'string'
						? typed.turnId
						: (extractMessageId(typed.message) ?? 'pending');
				const normalized = normalizeMessageEnd(message, wireRole);
				// Keep full text in `message_end` so it persists to SQLite and
				// rehydrates correctly on refetch. The renderer drops earlier
				// streaming parts of the same type when a done-state part lands.
				if (turnId !== 'pending') {
					streamedTurns.delete(turnId);
				}
				emit({
					at: now().toISOString(),
					payload: normalized,
					role: wireRole,
					turnId,
					type: 'message',
				});
				// Surface a model/provider failure (e.g. local server offline) that
				// would otherwise be an empty assistant bubble. Pi carries the cause
				// on the message itself, not in the content blocks.
				const stopReason =
					typeof message.stopReason === 'string' ? message.stopReason : null;
				const errorMessage =
					typeof message.errorMessage === 'string'
						? message.errorMessage
						: null;
				if (
					wireRole !== 'user' &&
					stopReason === 'error' &&
					errorMessage &&
					!promptErrorEmitted
				) {
					promptErrorEmitted = true;
					emitError('adapter-failure', errorMessage, undefined, true);
				}
				return;
			}
			// Tool execution lifecycle from Pi docs.
			case 'tool_execution_start':
			case 'tool_execution_update':
			case 'tool_execution_end': {
				const turnId =
					typeof typed.turnId === 'string'
						? typed.turnId
						: typeof typed.toolCallId === 'string'
							? typed.toolCallId
							: null;
				const normalized = normalizeToolExecutionFrame(typed);
				emit({
					at: now().toISOString(),
					payload: normalized,
					role: 'tool',
					turnId,
					type: 'message',
				});
				return;
			}
			// Legacy / fallback shapes.
			case 'tool_call':
			case 'tool_result':
			case 'message': {
				const role = isMessageRole(typed.role)
					? typed.role
					: typed.type === 'tool_result' || typed.type === 'tool_call'
						? 'tool'
						: 'agent';
				const turnId = typeof typed.turnId === 'string' ? typed.turnId : null;
				const normalized = normalizeLegacyMessageFrame(typed, role);
				emit({
					at: now().toISOString(),
					payload: normalized,
					role,
					turnId,
					type: 'message',
				});
				return;
			}
			case 'status': {
				const status = isSessionStatus(typed.status)
					? typed.status
					: 'streaming';
				setStatus(status);
				return;
			}
			case 'error': {
				emitError(
					'adapter-failure',
					typeof typed.message === 'string' ? typed.message : 'Pi RPC error.',
					typeof typed.detail === 'string' ? typed.detail : undefined,
					typed.recoverable !== false,
				);
				return;
			}
			default: {
				// Unknown frame — surface as agent message so the timeline at least
				// records it instead of dropping silently. Future versions of Pi may
				// add frame types we have not modelled yet.
				const frameType =
					typeof typed.type === 'string' ? typed.type : 'unknown';
				emit({
					at: now().toISOString(),
					payload: { frameType, kind: 'unknown', raw: typed },
					role: 'agent',
					turnId: typeof typed.turnId === 'string' ? typed.turnId : null,
					type: 'message',
				});
				return;
			}
		}
	};
}
