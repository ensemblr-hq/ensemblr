import { splitSettledMarkdown } from '@/renderer/lib/agent-timeline';
import { MessageResponse } from './message';

/**
 * Renders assistant prose as markdown via Streamdown, nothing else. An earlier
 * version split the text on blank lines and ran each paragraph through the
 * tool-output classifier; that shredded fenced code blocks containing blank
 * lines and boxed ordinary prose into Terminal/CodeBlock chrome. Markdown is
 * the assistant's native output format — Streamdown already handles fences,
 * tables, and inline code. The classifier remains in use where it belongs:
 * tool output payloads.
 *
 * A long answer is handed over in two pieces rather than one, split at the last
 * fenced code block that closed. Streamdown memoizes the blocks it has already
 * drawn, but it re-lexes the whole string on every delta to find where they
 * start and end — so one streamed token costs a walk over the whole answer, and
 * the answer only grows. The leading piece is a string that can no longer change,
 * so `MessageResponse`'s children-identity memo skips it outright and the
 * per-delta walk is bounded by the tail. `splitSettledMarkdown` owns which
 * boundaries are safe to cut on.
 */
export function ChatMessageText({
	className,
	text,
}: {
	className?: string;
	text: string;
}) {
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		return null;
	}
	const { settled, tail } = splitSettledMarkdown(trimmed);
	if (settled.length === 0) {
		return <MessageResponse className={className}>{trimmed}</MessageResponse>;
	}
	return (
		<>
			<MessageResponse className={className}>{settled}</MessageResponse>
			<MessageResponse className={className}>{tail}</MessageResponse>
		</>
	);
}
