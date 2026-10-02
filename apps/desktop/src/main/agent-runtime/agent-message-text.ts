import type { AgentEvent } from './agent-types.ts';

/**
 * Pulls finalized plain text out of a normalized agent message payload.
 * Reasoning, tool calls/results, prompt echoes, and streaming deltas are
 * intentionally excluded — only settled `text` parts are returned, so callers
 * that summarize a turn (branch name, chat title) never leak chain-of-thought.
 * @param event - A normalized `message` agent event.
 * @returns The joined finalized text, or an empty string when none is present.
 */
export function extractAgentMessageText(
	event: Extract<AgentEvent, { type: 'message' }>,
): string {
	const payload = event.payload;
	switch (payload.kind) {
		case 'text':
			return payload.text;
		case 'message':
			return payload.parts
				.flatMap((part) =>
					part.kind === 'text' && part.text ? [part.text] : [],
				)
				.join(' ')
				.trim();
		default:
			return '';
	}
}
