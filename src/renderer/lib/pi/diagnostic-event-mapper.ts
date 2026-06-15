import type { UIMessage } from 'ai';

import type {
	PiPersistedEnvelope,
	PiSessionEventWire,
} from '@/shared/ipc/contracts/pi-session';

/**
 * Projects a `stderr` Pi event into a compact `system`-role `UIMessage`, or
 * returns `null` when the chunk is empty / not actionable.
 *
 * Surfaces only lines matching the actionable allowlist (Error/Warning/crash
 * markers, recoverable error envelopes). Routine runtime chatter — session-
 * summary state dumps, lifecycle lines, structured `key: value` logs — is
 * dropped here. The raw stream is still captured by the debug raw-frame panel
 * for post-mortem inspection.
 */
export function buildStderrMessage(
	event: PiSessionEventWire,
): UIMessage | null {
	const detail = readStderrDetail(event.payload);
	const actionable = filterActionableStderr(detail);
	if (actionable === null) {
		return null;
	}
	return {
		id: `pi-event:${event.id}`,
		parts: [{ state: 'done', text: `[stderr] ${actionable}`, type: 'text' }],
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

/** Strong actionable signals. Anything that matches one of these gets through. */
const ACTIONABLE_MARKER =
	/\b(error|warning|fatal|panic|crash|traceback|exception)\b/i;
/** POSIX/Node errno codes (ENOENT, EACCES, ECONNRESET, ...). */
const ERRNO_CODE = /\bE[A-Z]{2,}\b/;
const STACK_FRAME = /\bat\s+\S+:\d+/;
const SHELL_PROMPT = /^\s*[$#]\s+\S/;

/**
 * Routine `key: value` log lines we know to drop. Pi runs an event-loop
 * summary writer that prints structured state to stderr (sessionId/branchId/
 * messageCount/...). Surfaced as warning blocks these read as noise.
 */
const STRUCTURED_LOG_LINE =
	/^(piSessionId|sessionId|branchId|chatTabId|model|summaryModel|messageCount|turnCount|closedAt|startedAt|status|workspaceCwd|workspaceId|usage|duration|elapsedMs|payloadBytes|chunkSize|stream|envelope)\s*[:=]/i;

const LIFECYCLE_LINE =
	/^(pi runtime|pi rpc|launching pi|attaching pi|pi session|pi child|pi adapter|spawning|connected to|disconnected from)/i;

/**
 * Decides whether a stderr `detail` is worth surfacing as a chat diagnostic.
 *
 * Strategy: split into lines, keep only lines that look actionable (Error/
 * Warning/crash/stack-frame), drop structured log lines and lifecycle chatter.
 * If at least one line survives, return the joined survivors; otherwise null.
 */
function filterActionableStderr(detail: string): string | null {
	const normalized = detail.trim();
	if (normalized.length === 0 || normalized === '(empty stderr chunk)') {
		return null;
	}
	const kept: string[] = [];
	for (const raw of normalized.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.length === 0) {
			continue;
		}
		if (STRUCTURED_LOG_LINE.test(line) || LIFECYCLE_LINE.test(line)) {
			continue;
		}
		if (
			ACTIONABLE_MARKER.test(line) ||
			ERRNO_CODE.test(line) ||
			STACK_FRAME.test(line) ||
			SHELL_PROMPT.test(line)
		) {
			kept.push(line);
		}
	}
	if (kept.length === 0) {
		return null;
	}
	return kept.join('\n');
}
