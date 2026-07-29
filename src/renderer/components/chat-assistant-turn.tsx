import type { DynamicToolUIPart, UIMessage } from 'ai';
import { useMemo } from 'react';
import { glyphForToolCall } from '@/renderer/lib/pi';
import { cn } from '@/renderer/lib/utils';
import type { ChatAssistantTurnTiming } from '@/renderer/types/chat';
import type { ToolGlyph } from '@/renderer/types/tool-presentation';

import { ChatMessageText } from './chat-message-text';
import { ChatReasoningCollapsible, ChatToolCall } from './chat-tool-call';
import { ChatTurnFooter } from './chat-turn-footer';
import { ChatTurnSummary } from './chat-turn-summary';
import { ChatWorkingIndicator } from './chat-turn-timer';

/**
 * One assistant turn in the new chat surface. Splits the message parts into:
 *   - finalParts: the TRAILING contiguous run of `text` parts — Pi's actual
 *     answer. Trailing because Pi interleaves commentary and tool calls; only
 *     the closing prose is the response the user reads.
 *   - activityParts: everything before that run (reasoning, tool calls, and
 *     intermediate text chunks emitted between tool calls).
 *
 * While the turn is streaming, activity renders live with a ticking timer.
 * Once it settles, all activity folds into a collapsed summary chip so the
 * markdown answer dominates the surface.
 */
export function ChatAssistantTurn({
	className,
	forkDisabled = false,
	isStreaming,
	message,
	onForkToNewTab,
	onForkToNewWorkspace,
	onRestoreToCheckpoint,
	onViewTurnDiff,
	timing,
}: {
	className?: string;
	/** Disables the footer fork menu while a fork is already running. */
	forkDisabled?: boolean;
	isStreaming: boolean;
	message: UIMessage;
	onForkToNewTab?: () => void;
	onForkToNewWorkspace?: () => void;
	onRestoreToCheckpoint?: () => void;
	onViewTurnDiff?: () => void;
	timing: ChatAssistantTurnTiming;
}) {
	const { activityParts, finalParts } = useMemo(
		() => splitTurnParts(message, isStreaming),
		[message, isStreaming],
	);

	const hasFinal = finalParts.length > 0;
	const activityRows = activityParts.map((part, index) => (
		<ActivityPart key={`${message.id}:a:${index}`} part={part} />
	));
	const toolGlyphs = useMemo(
		() => collectToolGlyphs(activityParts),
		[activityParts],
	);

	const finalRows = finalParts.map((part, index) => {
		const key = `${message.id}:f:${index}`;
		if (part.type === 'text') {
			return <ChatMessageText key={key} text={part.text} />;
		}
		return null;
	});

	const durationMs =
		timing.endMs !== null ? timing.endMs - timing.startMs : null;
	const answerText = useMemo(
		() =>
			finalParts
				.flatMap((part) =>
					part.type === 'text' && part.text ? [part.text] : [],
				)
				.join('\n\n'),
		[finalParts],
	);

	return (
		<div
			className={cn('flex w-full flex-col gap-2.5 text-foreground', className)}
			data-role='assistant-turn'
		>
			{hasFinal ? (
				activityRows.length > 0 ? (
					<ChatTurnSummary
						durationMs={null}
						messageCount={countIntermediateText(activityParts)}
						toolGlyphs={toolGlyphs}
					>
						{activityRows}
					</ChatTurnSummary>
				) : null
			) : (
				<>
					{activityRows.length > 0 ? (
						<div className='flex flex-col gap-1.5'>{activityRows}</div>
					) : null}
					{isStreaming ? (
						<ChatWorkingIndicator startMs={timing.startMs} />
					) : null}
				</>
			)}
			{finalRows.length > 0 ? (
				<div className='flex flex-col gap-2 text-sm'>{finalRows}</div>
			) : null}
			{!isStreaming ? (
				<ChatTurnFooter
					answerText={answerText}
					durationMs={durationMs}
					forkDisabled={forkDisabled}
					onForkToNewTab={onForkToNewTab}
					onForkToNewWorkspace={onForkToNewWorkspace}
					onRestoreToCheckpoint={onRestoreToCheckpoint}
					onViewTurnDiff={onViewTurnDiff}
				/>
			) : null}
		</div>
	);
}

/** Renders one pre-answer activity part: reasoning, a tool call, or muted intermediate commentary. */
function ActivityPart({ part }: { part: UIMessage['parts'][number] }) {
	if (part.type === 'reasoning') {
		return <ChatReasoningCollapsible text={part.text} />;
	}
	if (part.type === 'dynamic-tool') {
		return <ChatToolCall part={part as DynamicToolUIPart} />;
	}
	if (part.type === 'text') {
		// Intermediate commentary between tool calls — keep compact and muted
		// so it reads as progress narration, not the final answer.
		return (
			<ChatMessageText
				className='text-muted-foreground text-xs'
				text={part.text}
			/>
		);
	}
	return null;
}

/**
 * Final response = the trailing contiguous run of finalized text parts. While
 * the turn is still streaming everything stays in the activity feed — the
 * "answer" is only promoted once the stream settles, which prevents an
 * intermediate text chunk from being mistaken for the response and locking
 * earlier activity into a premature collapse.
 */
function splitTurnParts(
	message: UIMessage,
	isStreaming: boolean,
): {
	activityParts: UIMessage['parts'];
	finalParts: UIMessage['parts'];
} {
	if (isStreaming) {
		return { activityParts: message.parts, finalParts: [] };
	}
	let splitIndex = message.parts.length;
	for (let index = message.parts.length - 1; index >= 0; index -= 1) {
		const part = message.parts[index];
		const isFinalText =
			part?.type === 'text' && 'state' in part && part.state === 'done';
		if (!isFinalText) {
			break;
		}
		splitIndex = index;
	}
	return {
		activityParts: message.parts.slice(0, splitIndex),
		finalParts: message.parts.slice(splitIndex),
	};
}

/**
 * Collect the icon of every tool call folded into a turn's summary, in the
 * order the turn ran them.
 * @param parts - Message parts to scan
 * @returns One glyph per tool call
 */
function collectToolGlyphs(parts: UIMessage['parts']): readonly ToolGlyph[] {
	return parts.flatMap((part) =>
		part.type === 'dynamic-tool'
			? [glyphForToolCall(part as DynamicToolUIPart)]
			: [],
	);
}

/**
 * Count the intermediate text and reasoning parts that fold into a turn's activity summary.
 * @param parts - Message parts to scan
 * @returns The number of text or reasoning parts
 */
function countIntermediateText(parts: UIMessage['parts']): number {
	let count = 0;
	for (const part of parts) {
		if (part.type === 'text' || part.type === 'reasoning') {
			count += 1;
		}
	}
	return count;
}
