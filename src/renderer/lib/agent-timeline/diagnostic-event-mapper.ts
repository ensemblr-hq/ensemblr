import type { UIMessage } from 'ai';

import type { AgentNoticeMetadata } from '@/renderer/types/agent-timeline';
import type {
	AgentPersistedEnvelope,
	AgentSessionEventWire,
} from '@/shared/ipc/contracts/agent-session';
import { describesGracefulTermination } from '@/shared/process-exit';

/**
 * Projects an `error`-kind Pi envelope into a `system`-role `UIMessage`, or
 * returns `null` when the error is not a fatal failure.
 *
 * The timeline carries fatal failures only. Recoverable diagnostics — retried
 * commands, malformed frames, stderr chatter — are runtime bookkeeping the user
 * cannot act on, so they stay in the debug raw-frame panel for post-mortems
 * instead of interrupting the conversation. Graceful process exits are dropped
 * on message text as well: sessions recorded before the adapter stopped
 * reporting them still hold rows tagged fatal, and those replay on every load.
 * @param event - The wire event carrying the envelope, whose id keys the message
 * @param envelope - The `error` envelope to project
 * @returns The system message, or null when the error is not fatal
 */
export function buildErrorMessage(
	event: AgentSessionEventWire,
	envelope: Extract<AgentPersistedEnvelope, { kind: 'error' }>,
): UIMessage | null {
	const error = envelope.error;
	if (
		error.recoverable !== false ||
		describesGracefulTermination(error.message)
	) {
		return null;
	}
	const head = error.message || 'Runtime error';
	const body = error.detail ? `\n${error.detail}` : '';
	return {
		id: `pi-event:${event.id}`,
		parts: [{ state: 'done', text: `${head}${body}`, type: 'text' }],
		role: 'system',
	};
}

const INTERRUPTED_NOTICE_TEXT = 'You stopped this turn';

/**
 * Projects a `shutdown` envelope into the marker left where the user stopped a
 * turn, or returns `null` for every other way a session ends.
 *
 * Only `aborted` is worth a row: the user took an action and the transcript
 * should show why it trails off. Sessions that complete, crash, or close with
 * the app are bookkeeping the conversation does not need.
 * @param event - The wire event carrying the envelope, whose id keys the message
 * @param envelope - The `shutdown` envelope to project
 * @returns The interruption marker, or null when the session ended some other way
 */
export function buildInterruptedMessage(
	event: AgentSessionEventWire,
	envelope: Extract<AgentPersistedEnvelope, { kind: 'shutdown' }>,
): UIMessage | null {
	if (envelope.reason !== 'aborted') {
		return null;
	}
	return {
		id: `pi-event:${event.id}`,
		metadata: { notice: 'interrupted' } satisfies AgentNoticeMetadata,
		parts: [{ state: 'done', text: INTERRUPTED_NOTICE_TEXT, type: 'text' }],
		role: 'system',
	};
}
