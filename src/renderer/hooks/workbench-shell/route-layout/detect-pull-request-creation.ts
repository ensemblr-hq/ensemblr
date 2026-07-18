import { containsPullRequestUrl, mentionsGhPrCreate } from '@/shared/github';
import type {
	PiPersistedEnvelope,
	PiWireMessagePart,
	PiWireMessagePayload,
} from '@/shared/ipc/contracts/pi-message-payloads';

/** The strongest PR-creation signal extractable from a persisted Pi event. */
type PullRequestCreationSignal = 'create-command' | 'created-url';

/**
 * Coerce arbitrary tool input/output into a searchable string. Strings pass
 * through; everything else is JSON-serialized so a PR URL or `gh pr create`
 * command nested in structured data is still matchable.
 * @param value - Tool input or output of unknown shape.
 * @returns A string representation, or an empty string when serialization fails.
 */
function toSearchableText(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	if (value === null || value === undefined) {
		return '';
	}
	try {
		return JSON.stringify(value);
	} catch {
		return '';
	}
}

/**
 * Read a PR-creation signal from tool-call input.
 * @param input - Tool input to inspect for `gh pr create`.
 * @returns The create-command signal, or null when absent.
 */
function signalFromToolCallInput(
	input: unknown,
): PullRequestCreationSignal | null {
	return mentionsGhPrCreate(toSearchableText(input)) ? 'create-command' : null;
}

/**
 * Read a PR-creation signal from tool-result output.
 * @param output - Tool output to inspect for the created PR URL.
 * @returns The created-url signal, or null when absent.
 */
function signalFromToolResultOutput(
	output: unknown,
): PullRequestCreationSignal | null {
	return containsPullRequestUrl(toSearchableText(output))
		? 'created-url'
		: null;
}

/**
 * Read a PR-creation signal from a finalized message part.
 * @param part - Message part to inspect.
 * @returns The part's PR-creation signal, or null when absent.
 */
function signalFromMessagePart(
	part: PiWireMessagePart,
): PullRequestCreationSignal | null {
	if (part.kind === 'tool-call') {
		return signalFromToolCallInput(part.input);
	}
	if (part.kind === 'tool-result') {
		return signalFromToolResultOutput(part.output);
	}
	return null;
}

/**
 * Read the strongest PR-creation signal from finalized message parts.
 * @param parts - Message parts to inspect.
 * @returns A created-url signal when present, otherwise a create-command signal.
 */
function signalFromMessageParts(
	parts: readonly PiWireMessagePart[],
): PullRequestCreationSignal | null {
	let fallback: PullRequestCreationSignal | null = null;
	for (const part of parts) {
		const signal = signalFromMessagePart(part);
		if (signal === 'created-url') {
			return signal;
		}
		if (signal === 'create-command') {
			fallback = signal;
		}
	}
	return fallback;
}

/**
 * Read a PR-creation signal from any persisted message payload shape.
 * @param payload - Message payload to inspect.
 * @returns The payload's PR-creation signal, or null when absent.
 */
function signalFromMessagePayload(
	payload: PiWireMessagePayload,
): PullRequestCreationSignal | null {
	if (payload.kind === 'tool-call') {
		return signalFromToolCallInput(payload.input);
	}
	if (payload.kind === 'tool-result') {
		return signalFromToolResultOutput(payload.output);
	}
	if (payload.kind === 'message') {
		return signalFromMessageParts(payload.parts);
	}
	return null;
}

/**
 * Read whether a persisted event reports a PR create command or created PR URL.
 * @param envelope - The persisted session-event envelope from the broadcast.
 * @returns The event's PR-creation signal, or null when absent.
 */
function pullRequestCreationSignal(
	envelope: PiPersistedEnvelope,
): PullRequestCreationSignal | null {
	if (envelope.kind !== 'message') {
		return null;
	}
	return signalFromMessagePayload(envelope.payload);
}

/**
 * Detect whether a persisted session event signals that the agent created a
 * pull request this turn — either a `gh pr create` tool call or a tool result
 * carrying the resulting PR URL. Used to gate the retry-until-present refresh so
 * the extra `gh pr view` calls only run when a PR was actually created.
 * @param envelope - The persisted session-event envelope from the broadcast.
 * @returns True when the event references creating a pull request.
 */
export function isPullRequestCreationEvent(
	envelope: PiPersistedEnvelope,
): boolean {
	return pullRequestCreationSignal(envelope) !== null;
}

/**
 * Detect whether a persisted session event marks the end of an agent turn — a
 * `status` event transitioning from streaming/starting to idle. This is the
 * canonical "agent finished producing a result" signal, reused by the PR
 * auto-refresh and the unread auto-mark behavior.
 * @param envelope - The persisted session-event envelope from the broadcast.
 * @returns True when the event ends an agent turn.
 */
export function isFinishedTurnEvent(envelope: PiPersistedEnvelope): boolean {
	return (
		envelope.kind === 'status' &&
		envelope.status === 'idle' &&
		(envelope.previous === 'starting' || envelope.previous === 'streaming')
	);
}

/**
 * The next mutation the auto-refresh hook should apply for a session event,
 * given whether the current turn has already produced a PR-creation signal.
 * Modeling the branching as a pure value keeps the hook's subscriber callback
 * flat and lets the turn state machine be unit-tested without React.
 */
export type PullRequestRefreshAction =
	| { kind: 'mark-created' }
	| { kind: 'reset' }
	| { kind: 'refresh'; createdPr: boolean }
	| { kind: 'none' };

/**
 * Classify a persisted session event into the auto-refresh action to take. PR
 * create commands arm the retry-until-present refresh; created PR URLs request
 * it immediately; a turn start clears arming; and a turn end requests a final
 * refresh carrying whether a PR was created this turn.
 * @param envelope - The persisted session-event envelope from the broadcast.
 * @param prCreatedThisTurn - Whether a PR-creation event has fired this turn.
 * @returns The action the hook should apply.
 */
export function classifyPullRequestRefreshAction(
	envelope: PiPersistedEnvelope,
	prCreatedThisTurn: boolean,
): PullRequestRefreshAction {
	const signal = pullRequestCreationSignal(envelope);
	if (signal === 'created-url') {
		return { createdPr: true, kind: 'refresh' };
	}
	if (signal === 'create-command') {
		return { kind: 'mark-created' };
	}
	if (envelope.kind !== 'status') {
		return { kind: 'none' };
	}
	if (envelope.status === 'streaming' || envelope.status === 'starting') {
		return { kind: 'reset' };
	}
	if (!isFinishedTurnEvent(envelope)) {
		return { kind: 'none' };
	}
	return { createdPr: prCreatedThisTurn, kind: 'refresh' };
}
