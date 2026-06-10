import type { UIMessage } from 'ai';

import type { PiPersistedEnvelope, PiSessionEventWire } from '@/shared/ipc';

/**
 * Projects a `stderr` Pi event into a compact `system`-role `UIMessage`, or
 * returns `null` when the chunk is empty / not actionable.
 *
 * Empty stderr is common during normal startup and shutdown chatter and would
 * pollute the chat timeline if surfaced.
 */
export function buildStderrMessage(
	event: PiSessionEventWire,
): UIMessage | null {
	const detail = readStderrDetail(event.payload);
	if (!isActionableDiagnostic(detail)) {
		return null;
	}
	return {
		id: `pi-event:${event.id}`,
		parts: [{ state: 'done', text: `[stderr] ${detail}`, type: 'text' }],
		role: 'system',
	};
}

/**
 * Projects an `error`-kind Pi envelope into a `system`-role `UIMessage`,
 * tagging it as `fatal` or `recoverable` so the timeline can style accordingly.
 */
export function buildErrorMessage(
	event: PiSessionEventWire,
	envelope: Extract<PiPersistedEnvelope, { kind: 'error' }>,
): UIMessage {
	const error = envelope.error;
	const tag = error.recoverable === false ? 'fatal' : 'recoverable';
	const head = error.message || 'Runtime error';
	const body = error.detail ? `\n${error.detail}` : '';
	return {
		id: `pi-event:${event.id}`,
		parts: [{ state: 'done', text: `[${tag}] ${head}${body}`, type: 'text' }],
		role: 'system',
	};
}

function readStderrDetail(payload: PiPersistedEnvelope | null): string {
	if (payload?.kind === 'error') {
		return (
			payload.error.detail ?? payload.error.message ?? '(empty stderr chunk)'
		);
	}
	return '(empty stderr chunk)';
}

function isActionableDiagnostic(detail: string): boolean {
	const normalized = detail.trim();
	return normalized.length > 0 && normalized !== '(empty stderr chunk)';
}
