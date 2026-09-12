import type { AgentEvent } from './agent-types.ts';

/**
 * Whether an event belongs in the transcript at all.
 *
 * A runtime frame the app does not model reaches the pipeline as a `message`
 * event with an `unknown` payload, and the timeline renders nothing for it
 * (`event-to-ui-message.ts` answers `unknown` with no parts). Persisting one is
 * therefore a debug feature paid for on the main thread: a durable write, a
 * broadcast to every window, and a row that is re-read and re-cloned on every
 * later replay of that branch.
 *
 * Pi's fire-and-forget status-line and widget repaints are exactly that shape.
 * They accounted for 706,547 of 891,177 rows in the live database — 79% of the
 * table and 165 MB of payload — for a branch the projector folds into two
 * messages. The raw-frame debug tap already covers inspecting them.
 * @param event - Normalized runtime event.
 * @returns True when the event should be persisted and broadcast.
 */
export function isTimelineAgentEvent(event: AgentEvent): boolean {
	return event.type !== 'message' || event.payload.kind !== 'unknown';
}
