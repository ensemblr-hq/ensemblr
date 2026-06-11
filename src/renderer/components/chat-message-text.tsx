import { MessageResponse } from './message';

/**
 * Renders assistant prose as markdown via Streamdown, nothing else. An earlier
 * version split the text on blank lines and ran each paragraph through the
 * tool-output classifier; that shredded fenced code blocks containing blank
 * lines and boxed ordinary prose into Terminal/CodeBlock chrome. Markdown is
 * the assistant's native output format — Streamdown already handles fences,
 * tables, and inline code. The classifier remains in use where it belongs:
 * tool output payloads.
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
	return <MessageResponse className={className}>{trimmed}</MessageResponse>;
}
