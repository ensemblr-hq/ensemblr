import type { DynamicToolUIPart, UIMessage } from 'ai';

/**
 * Internal type aliases shared by the Pi → UI message mapper and its
 * concern-specific sub-mappers (text, tool, diagnostic). These types are not
 * part of the renderer public surface — they live here only because the
 * dispatcher and sub-mappers must agree on the same `UIMessage['parts']`
 * narrowings.
 */

export type UIRole = UIMessage['role'];

export type UIMessagePart = UIMessage['parts'][number];

/** Tool part variant that carries a result (success or error). */
export type DynamicToolOutputPart = Extract<
	DynamicToolUIPart,
	{ state: 'output-available' | 'output-error' }
>;

/** Text or reasoning part that is still streaming deltas. */
export type StreamingTextPart = Extract<
	UIMessagePart,
	{ type: 'text' | 'reasoning' }
> & { state: 'streaming' };

/**
 * Buffer for consecutive same-turn, same-role message events while they are
 * being collapsed into a single `UIMessage`.
 */
export interface PendingGroup {
	id: string;
	parts: UIMessagePart[];
	role: UIRole;
	signature: string;
}
