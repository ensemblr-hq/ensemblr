import type { DynamicToolUIPart, UIMessage } from 'ai';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { cn } from '@/renderer/lib/utils';

import { ChatReasoningRow, ChatToolRow } from './chat-activity-row';
import { ChatMessageText } from './chat-message-text';
import { ChatTurnFooter } from './chat-turn-footer';
import { ChatTurnSummary } from './chat-turn-summary';
import { ChatTurnTimer } from './chat-turn-timer';

export interface ChatAssistantTurnTiming {
	endMs: number | null;
	startMs: number;
}

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
	renderToolDetail,
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
	renderToolDetail?: (part: DynamicToolUIPart) => ReactNode;
	timing: ChatAssistantTurnTiming;
}) {
	const { activityParts, finalParts } = useMemo(
		() => splitTurnParts(message, isStreaming),
		[message, isStreaming],
	);

	const hasFinal = finalParts.length > 0;
	const activityRows = activityParts.map((part, index) => (
		<ActivityPart
			key={`${message.id}:a:${index}`}
			part={part}
			renderToolDetail={hasFinal ? renderToolDetail : undefined}
		/>
	));

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
				.map((part) => (part.type === 'text' ? part.text : ''))
				.filter(Boolean)
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
						toolCount={countByType(activityParts, 'dynamic-tool')}
					>
						{activityRows}
					</ChatTurnSummary>
				) : null
			) : (
				<>
					{activityRows.length > 0 ? (
						<div className='flex flex-col gap-1.5'>{activityRows}</div>
					) : null}
					{isStreaming ? <ChatTurnTimer startMs={timing.startMs} /> : null}
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

function ActivityPart({
	part,
	renderToolDetail,
}: {
	part: UIMessage['parts'][number];
	renderToolDetail?: (part: DynamicToolUIPart) => ReactNode;
}) {
	if (part.type === 'reasoning') {
		return <ChatReasoningRow text={part.text} />;
	}
	if (part.type === 'dynamic-tool') {
		const detail = renderToolDetail?.(part as DynamicToolUIPart);
		return (
			<>
				<ChatToolRow part={part as DynamicToolUIPart} />
				{detail ? <div className='pl-6 text-xs'>{detail}</div> : null}
			</>
		);
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

function countByType(
	parts: UIMessage['parts'],
	type: 'reasoning' | 'dynamic-tool',
): number {
	let count = 0;
	for (const part of parts) {
		if (part.type === type) {
			count += 1;
		}
	}
	return count;
}

function countIntermediateText(parts: UIMessage['parts']): number {
	let count = 0;
	for (const part of parts) {
		if (part.type === 'text' || part.type === 'reasoning') {
			count += 1;
		}
	}
	return count;
}
