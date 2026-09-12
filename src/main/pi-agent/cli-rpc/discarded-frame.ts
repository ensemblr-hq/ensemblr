/**
 * Recovery for a Pi RPC line the transport had to discard.
 *
 * A discarded line is unparseable by definition — only its leading bytes
 * survive. That matters most when the line was a tool's completion frame: the
 * tool really did finish, but nothing downstream ever hears so, and the call
 * stays in the live activity projection for the rest of the turn, freezing the
 * Agents-panel preview on a tool that ended long ago.
 *
 * Pi serializes a `tool_execution_end` with its identity fields first, so the
 * retained prefix carries the `toolCallId` even when the payload behind it is
 * megabytes of base64. That is enough to settle the call.
 */

/** A tool completion recovered from the prefix of a discarded RPC line. */
export interface RecoveredToolCompletion {
	isError: true;
	result: { content: readonly { text: string; type: 'text' }[] };
	toolCallId: string;
	type: 'tool_execution_end';
}

const TOOL_CALL_ID_PATTERN = /"toolCallId"\s*:\s*"([^"]+)"/;
// Pi reports one completed tool three ways — `tool_execution_end` plus the
// `message_start`/`message_end` pair carrying a `toolResult` role — and only
// this one is matched. The pair never arrives without it, so matching them too
// would add no recovery; it would only synthesize the same completion three
// times, and their envelopes run ~40 bytes longer, so a result sitting in that
// window delivers its real `tool_execution_end` under the cap while the pair
// trips it. The synthetic failure outranks a real `output-available` result in
// the timeline's merge, so matching the pair would replace an intact result
// with an error. A tool *call* frame is excluded for the same reason in
// reverse: synthesizing a result for a call nobody has seen start would
// tombstone the real one.
const TOOL_COMPLETION_MARKER = '"type":"tool_execution_end"';

/**
 * Recovers the tool completion a discarded RPC line would have delivered.
 * @param prefix - Leading characters retained from the discarded line
 * @param reason - Human-readable explanation shown as the tool's failed output
 * @returns A synthetic completion frame, or null when the prefix identifies no finished tool
 */
export function recoverToolCompletion(
	prefix: string,
	reason: string,
): RecoveredToolCompletion | null {
	if (!prefix.includes(TOOL_COMPLETION_MARKER)) {
		return null;
	}
	const toolCallId = TOOL_CALL_ID_PATTERN.exec(prefix)?.[1];
	if (!toolCallId) {
		return null;
	}
	return {
		isError: true,
		result: { content: [{ text: reason, type: 'text' }] },
		toolCallId,
		type: 'tool_execution_end',
	};
}
