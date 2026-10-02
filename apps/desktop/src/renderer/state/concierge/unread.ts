/**
 * What the Concierge has done while nobody was looking, and whether it is still
 * working.
 *
 * The app's per-chat unread system cannot carry this: an entry there is keyed by
 * a workspace and a chat tab, and the Concierge has neither — which is why
 * `useAutoMarkUnread` skips it outright. This is the Concierge's own, much
 * smaller version of the same idea, read by the launcher bubble.
 */
import { atom } from 'jotai';
import type {
	AgentPersistedEnvelope,
	AgentWireMessagePayload,
} from '@/shared/ipc/contracts/agent-message-payloads';

/**
 * What the Concierge produced since its panel was last open. `sessionId` is held
 * alongside the count because clearing the context replaces the session, and a
 * count carried across that replacement would be describing a conversation the
 * user can no longer open.
 */
export interface ConciergeActivityState {
	/** Agent prose messages that landed while the panel was closed. */
	count: number;
	/** Whether a questionnaire is blocking the Concierge right now. */
	hasQuestion: boolean;
	/** Session the count describes, or null when nothing has been counted. */
	sessionId: string | null;
}

/** Nothing seen and nothing pending: what the launcher shows no badge for. */
export const CONCIERGE_ACTIVITY_NONE: ConciergeActivityState = {
	count: 0,
	hasQuestion: false,
	sessionId: null,
};

/**
 * What the Concierge has produced unseen. Ephemeral, like the presentation it is
 * paired with: a fresh window has an empty transcript on screen and nothing to
 * report yet.
 */
export const conciergeActivityAtom = atom<ConciergeActivityState>(
	CONCIERGE_ACTIVITY_NONE,
);

/**
 * Whether the Concierge is mid-turn. The one answer to that question: the panel
 * reads it too, rather than deriving a second one from its own transcript, so
 * the bubble and the composer can never disagree about whether a turn is
 * running. Held here rather than in the panel because the launcher needs it with
 * the panel shut — and from a settings route, where the panel is not mounted.
 */
export const conciergeStreamingAtom = atom(false);

/**
 * Whether a status the runtime reported means a turn is in flight.
 *
 * `starting` counts: the child is spinning up for a prompt that has already been
 * submitted, and a launcher that stayed still until the first token would read
 * as nothing having happened.
 * @param status - The status a `status` event carried.
 * @returns True while a turn is running.
 */
export function isConciergeStreamingStatus(status: string): boolean {
	return status === 'starting' || status === 'streaming';
}

/**
 * Reports whether an event is the Concierge saying something to the user, as
 * opposed to thinking, calling a tool, or streaming a fragment of a message it
 * will send in full a moment later.
 *
 * Both runtimes normalize a finished message into a `message` payload
 * (`pi-wire-normalizer.ts`, `sdk-message-normalizer.ts`), so counting that is
 * one per message rather than one per token. A bare `text` payload is counted
 * too because the wire allows it; no adapter emits both for the same prose, so
 * accepting both cannot double-count one message.
 * @param envelope - The event's payload, or null when the stored JSON was unreadable.
 * @returns True when the event is one finished piece of agent prose.
 */
export function isConciergeAgentMessage(
	envelope: AgentPersistedEnvelope | null,
): boolean {
	if (envelope?.kind !== 'message' || envelope.role !== 'agent') {
		return false;
	}
	return hasProse(envelope.payload);
}

/**
 * Whether a message payload carries prose the user would read.
 * @param payload - The normalized message payload.
 * @returns True when it holds non-empty text.
 */
function hasProse(payload: AgentWireMessagePayload): boolean {
	if (payload.kind === 'text') {
		return payload.text.trim().length > 0;
	}
	if (payload.kind === 'message') {
		return payload.parts.some(
			(part) => part.kind === 'text' && part.text.trim().length > 0,
		);
	}
	return false;
}

/**
 * Counts one more unseen message, restarting the count when the session behind
 * it is not the one already counted.
 * @param state - The activity so far.
 * @param sessionId - Session the message arrived on.
 * @returns The next activity state.
 */
export function noteConciergeMessage(
	state: ConciergeActivityState,
	sessionId: string,
): ConciergeActivityState {
	if (state.sessionId !== sessionId) {
		return { count: 1, hasQuestion: false, sessionId };
	}
	return { ...state, count: state.count + 1 };
}

/**
 * Records whether a questionnaire is blocking, dropping any count held for a
 * different session for the same reason {@link noteConciergeMessage} does.
 * @param state - The activity so far.
 * @param sessionId - Session the question belongs to, or null when there is none.
 * @param hasQuestion - Whether that session is blocked on an ask.
 * @returns The next activity state.
 */
export function setConciergeQuestion(
	state: ConciergeActivityState,
	sessionId: string | null,
	hasQuestion: boolean,
): ConciergeActivityState {
	if (!hasQuestion) {
		return state.hasQuestion ? { ...state, hasQuestion: false } : state;
	}
	if (!sessionId) {
		return state;
	}
	if (state.sessionId !== sessionId) {
		return { count: 0, hasQuestion: true, sessionId };
	}
	return state.hasQuestion ? state : { ...state, hasQuestion: true };
}

/**
 * Drops everything held, which is what opening the panel does — the transcript
 * on screen is the report. Returns the same object when there was nothing held,
 * so an open panel does not re-render the launcher on every keystroke elsewhere.
 * @param state - The activity so far.
 * @returns The emptied activity state.
 */
export function clearConciergeActivity(
	state: ConciergeActivityState,
): ConciergeActivityState {
	return state.count === 0 && !state.hasQuestion && state.sessionId === null
		? state
		: CONCIERGE_ACTIVITY_NONE;
}

/**
 * How many things the badge reports. A blocked questionnaire counts as one on
 * top of the messages: it is a separate thing waiting, and it is the one the
 * user most needs to come back for.
 * @param state - The activity so far.
 * @returns The number to show, zero when there is nothing to report.
 */
export function conciergeBadgeCount(state: ConciergeActivityState): number {
	return state.count + (state.hasQuestion ? 1 : 0);
}
