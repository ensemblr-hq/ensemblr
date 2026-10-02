import type { AgentPersistedEnvelope } from '@/shared/ipc/contracts/agent-message-payloads';
import type { AgentSessionEventWire } from '@/shared/ipc/contracts/agent-session';
import type { ConciergeSessionEventWire } from '@/shared/ipc/contracts/concierge';

/**
 * Builds one transcript event. Ordinals and ids are assigned by
 * {@link buildTranscript}, so a scenario writes the conversation rather than its
 * bookkeeping.
 */
type TranscriptStep = (context: {
	branchId: string;
	createdAt: string;
	ordinal: number;
	turnId: string;
}) => AgentSessionEventWire;

/** Milliseconds between successive events in a transcript. */
const STEP_INTERVAL_MS = 1_400;

/**
 * How long before the frozen clock the last event lands. A live turn's timer
 * reads `now` minus the turn's first event, so a transcript stamped at or after
 * the frozen instant would render `0.0s` — the one detail that gives a staged
 * mid-turn shot away.
 */
const TRAILING_GAP_MS = 2_600;

/**
 * Wraps an envelope as a persisted event row, filling the fields every step
 * shares.
 * @param eventType - Descriptive tag stored on the row; the timeline projector reads the payload, not this.
 * @param payload - The tagged envelope the projector pattern-matches on.
 * @returns A step the transcript builder can number and time.
 */
function step(
	eventType: string,
	payload: AgentPersistedEnvelope,
): TranscriptStep {
	return ({ branchId, createdAt, ordinal, turnId }) => ({
		branchId,
		createdAt,
		eventType,
		id: `${branchId}-${ordinal}`,
		ordinal,
		payload,
		stream: 'protocol',
		turnId,
	});
}

/**
 * The user's message that opens a turn.
 * @param prompt - Prompt text as the user typed it.
 * @returns A transcript step rendering a user prompt row.
 */
export function userPrompt(prompt: string): TranscriptStep {
	return step('message', {
		kind: 'message',
		payload: { kind: 'prompt', prompt },
		role: 'user',
	});
}

/**
 * Agent prose. Several in a row collapse into one assistant turn, exactly as a
 * real session's do.
 * @param text - Markdown the agent wrote.
 * @returns A transcript step rendering assistant text.
 */
export function assistantText(text: string): TranscriptStep {
	return step('message', {
		kind: 'message',
		payload: { kind: 'text', text },
		role: 'agent',
	});
}

/**
 * A collapsed reasoning block above the agent's answer.
 * @param text - The reasoning body.
 * @returns A transcript step rendering a reasoning row.
 */
export function reasoning(text: string): TranscriptStep {
	return step('message', {
		kind: 'message',
		payload: { kind: 'reasoning', text },
		role: 'agent',
	});
}

/**
 * A tool the agent invoked. Pair it with {@link toolResult} under the same
 * `toolCallId` to render a settled card; leave the result off to freeze the card
 * mid-run, which is what a streaming shot wants.
 * @param name - Tool name as the runtime reports it, e.g. `Read`.
 * @param toolCallId - Id linking this call to its result.
 * @param input - The tool's arguments, rendered in the card's header and body.
 * @returns A transcript step rendering a tool call.
 */
export function toolCall(
	name: string,
	toolCallId: string,
	input: unknown,
): TranscriptStep {
	return step('message', {
		kind: 'message',
		payload: { input, kind: 'tool-call', name, toolCallId },
		role: 'agent',
	});
}

/**
 * The output a tool returned, folded into its call's card.
 * @param toolCallId - Id of the call this answers.
 * @param output - The tool's result, rendered in the card body.
 * @param isError - Whether the card renders as a failure.
 * @returns A transcript step rendering a tool result.
 */
export function toolResult(
	toolCallId: string,
	output: unknown,
	isError = false,
): TranscriptStep {
	return step('message', {
		kind: 'message',
		payload: { isError, kind: 'tool-result', output, toolCallId },
		role: 'tool',
	});
}

/**
 * The context-window gauge reading shown beside the composer.
 * @param tokens - Tokens consumed so far.
 * @param contextWindow - Size of the window they are consumed from.
 * @returns A transcript step carrying a context-usage reading.
 */
export function contextUsage(
	tokens: number,
	contextWindow: number,
): TranscriptStep {
	return step('context-usage', {
		kind: 'context-usage',
		usage: {
			contextWindow,
			percent: Math.round((tokens / contextWindow) * 100),
			tokens,
		},
	});
}

/**
 * Numbers a scenario's steps, stamps each with a clock, and groups them into
 * turns.
 *
 * Events are back-dated from the scenario's frozen instant rather than counted
 * forward from it, so the conversation reads as having just happened and every
 * elapsed-time label in the UI shows a plausible number.
 *
 * A new turn starts at every {@link userPrompt}, which is the same rule the
 * timeline groups assistant rows by — so a transcript reads as the conversation
 * it describes without the scenario naming a single turn id.
 * @param branchId - Branch the events belong to; the timeline queries by it.
 * @param frozenAt - The scenario's frozen clock; the transcript ends just before it.
 * @param steps - The conversation, in order.
 * @returns The persisted event rows the demo bridge serves.
 */
export function buildTranscript(
	branchId: string,
	frozenAt: string,
	steps: readonly TranscriptStep[],
): readonly AgentSessionEventWire[] {
	const startMs =
		Date.parse(frozenAt) - TRAILING_GAP_MS - steps.length * STEP_INTERVAL_MS;
	let turnIndex = 0;
	return steps.map((build, index) => {
		const event = build({
			branchId,
			createdAt: new Date(startMs + index * STEP_INTERVAL_MS).toISOString(),
			ordinal: index + 1,
			turnId: `${branchId}-turn-${turnIndex}`,
		});
		if (isPromptEvent(event)) {
			turnIndex += 1;
			return { ...event, turnId: `${branchId}-turn-${turnIndex}` };
		}
		return event;
	});
}

/**
 * Re-stamps a transcript as Concierge events, which carry a session id and no
 * branch or turn. The Concierge renders through the same timeline components, so
 * a scenario writes its conversation with the same builders.
 * @param sessionId - Concierge session the events belong to.
 * @param events - Events from {@link buildTranscript}.
 * @returns The events as the Concierge panel reads them.
 */
export function asConciergeTranscript(
	sessionId: string,
	events: readonly AgentSessionEventWire[],
): readonly ConciergeSessionEventWire[] {
	return events.map((event) => ({
		createdAt: event.createdAt,
		eventType: event.eventType,
		id: event.id,
		ordinal: event.ordinal,
		payload: event.payload,
		sessionId,
		stream: 'protocol',
	}));
}

/**
 * Whether an event opens a new turn, which is what a user prompt does.
 * @param event - The event under test.
 * @returns True when the event carries a user prompt.
 */
function isPromptEvent(event: AgentSessionEventWire): boolean {
	return (
		event.payload?.kind === 'message' && event.payload.payload.kind === 'prompt'
	);
}
