import { containsPullRequestUrl, mentionsGhPrCreate } from '@/shared/github';
import type { PiPersistedEnvelope } from '@/shared/ipc/contracts/pi-message-payloads';

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
	if (envelope.kind !== 'message' || envelope.role !== 'tool') {
		return false;
	}
	const payload = envelope.payload;
	if (payload.kind === 'tool-call') {
		return mentionsGhPrCreate(toSearchableText(payload.input));
	}
	if (payload.kind === 'tool-result') {
		return containsPullRequestUrl(toSearchableText(payload.output));
	}
	return false;
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
 * creation events arm the retry-until-present refresh; a turn start clears that
 * arming; a turn end (idle after starting/streaming) requests the refresh,
 * carrying whether a PR was created this turn.
 * @param envelope - The persisted session-event envelope from the broadcast.
 * @param prCreatedThisTurn - Whether a PR-creation event has fired this turn.
 * @returns The action the hook should apply.
 */
export function classifyPullRequestRefreshAction(
	envelope: PiPersistedEnvelope,
	prCreatedThisTurn: boolean,
): PullRequestRefreshAction {
	if (isPullRequestCreationEvent(envelope)) {
		return { kind: 'mark-created' };
	}
	if (envelope.kind !== 'status') {
		return { kind: 'none' };
	}
	if (envelope.status === 'streaming' || envelope.status === 'starting') {
		return { kind: 'reset' };
	}
	const finishedTurn =
		envelope.status === 'idle' &&
		(envelope.previous === 'starting' || envelope.previous === 'streaming');
	if (!finishedTurn) {
		return { kind: 'none' };
	}
	return { createdPr: prCreatedThisTurn, kind: 'refresh' };
}
