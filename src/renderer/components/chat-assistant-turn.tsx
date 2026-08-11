import type { DynamicToolUIPart, UIMessage } from 'ai';
import { useMemo } from 'react';
import {
	countNestedToolCalls,
	dropEchoedSubagentReports,
	glyphForToolCall,
	groupSubagentActivity,
	isHiddenEnsemblrToolCall,
	parentToolCallIdOf,
} from '@/renderer/lib/agent-timeline';
import { customMessageDataOf, skillPartDataOf } from '@/renderer/lib/pi';
import { cn } from '@/renderer/lib/utils';
import type { TimelineActivityNode } from '@/renderer/types/agent-timeline';
import type { ChatAssistantTurnTiming } from '@/renderer/types/chat';
import type { ToolGlyph } from '@/renderer/types/tool-presentation';

import { ChatMessageText } from './chat-message-text';
import { ChatSubagentCall } from './chat-subagent-call';
import {
	ChatCustomMessage,
	ChatReasoningCollapsible,
	ChatSkillInvocation,
	ChatToolCall,
} from './chat-tool-call';
import { ChatTurnFooter } from './chat-turn-footer';
import { ChatTurnSummary } from './chat-turn-summary';
import { ChatWorkingIndicator } from './chat-turn-timer';

/**
 * One assistant turn in the new chat surface. Splits the message parts into:
 *   - finalParts: the TRAILING contiguous run of `text` parts — the agent's
 *     actual answer. Trailing because agents interleave commentary and tool
 *     calls; only the closing prose is the response the user reads.
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
		() => splitTurnParts(visibleTurnParts(message.parts), isStreaming),
		[message.parts, isStreaming],
	);

	const hasFinal = finalParts.length > 0;
	const activityNodes = useMemo(
		() => groupSubagentActivity(activityParts),
		[activityParts],
	);
	const activityRows = activityNodes.map((node) => (
		<ActivityNodeRow key={`${message.id}:a:${node.key}`} node={node} />
	));
	const toolGlyphs = useMemo(
		() => collectActivityGlyphs(activityParts),
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

/**
 * Renders one activity row and, when a subagent ran inside it, the rows it
 * produced. Recursion lives here rather than in the card so the card needs to
 * know nothing about part types, and so a row that turns out to have no children
 * renders exactly as it did before subagents were nested at all.
 */
function ActivityNodeRow({ node }: { node: TimelineActivityNode }) {
	const { part } = node;
	if (node.children.length === 0 || part.type !== 'dynamic-tool') {
		return <ActivityPart part={part} />;
	}
	return (
		<ChatSubagentCall part={part} toolCallCount={countNestedToolCalls(node)}>
			{node.children.map((child) => (
				<ActivityNodeRow key={child.key} node={child} />
			))}
		</ChatSubagentCall>
	);
}

/** Renders one pre-answer activity part: reasoning, a tool call, a skill activation, injected context, or muted intermediate commentary. */
function ActivityPart({ part }: { part: UIMessage['parts'][number] }) {
	if (part.type === 'reasoning') {
		return <ChatReasoningCollapsible text={part.text} />;
	}
	if (part.type === 'dynamic-tool') {
		return <ChatToolCall part={part as DynamicToolUIPart} />;
	}
	const skillData = skillPartDataOf(part);
	if (skillData) {
		return <ChatSkillInvocation name={skillData.name} />;
	}
	const customData = customMessageDataOf(part);
	if (customData) {
		return <ChatCustomMessage data={customData} />;
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
 * Drops the parts that paint nothing.
 *
 * The app's own bookkeeping calls go first, so naming a tab or filing a session
 * summary neither costs the turn a row nor stands between the answer and the end
 * of the turn — the split below promotes only the text that trails the last part,
 * so a hidden call left in place would fold the answer away with it. Reasoning
 * blocks whose runtime redacted the prose go too: dropping them here, rather than
 * at the row, also keeps them out of the summary's message count. So does a
 * subagent's closing prose, which its own card already shows as the body.
 * @param parts - The turn's parts, in the order it produced them
 * @returns The parts the timeline renders
 */
function visibleTurnParts(parts: UIMessage['parts']): UIMessage['parts'] {
	const painted = parts.filter((part) => {
		if (part.type === 'reasoning') {
			return part.text.trim().length > 0;
		}
		return (
			part.type !== 'dynamic-tool' ||
			!isHiddenEnsemblrToolCall(part as DynamicToolUIPart)
		);
	});
	return dropEchoedSubagentReports(painted);
}

/**
 * Final response = the trailing contiguous run of finalized text parts. While
 * the turn is still streaming everything stays in the activity feed — the
 * "answer" is only promoted once the stream settles, which prevents an
 * intermediate text chunk from being mistaken for the response and locking
 * earlier activity into a premature collapse.
 *
 * A subagent's own closing prose is never the turn's answer, however late it
 * lands: it belongs to the delegation that produced it, and promoting it would
 * both lift it out of its card and hide the agent's real response behind it.
 */
function splitTurnParts(
	parts: UIMessage['parts'],
	isStreaming: boolean,
): {
	activityParts: UIMessage['parts'];
	finalParts: UIMessage['parts'];
} {
	if (isStreaming) {
		return { activityParts: parts, finalParts: [] };
	}
	let splitIndex = parts.length;
	for (let index = parts.length - 1; index >= 0; index -= 1) {
		const part = parts[index];
		const isFinalText =
			part?.type === 'text' &&
			'state' in part &&
			part.state === 'done' &&
			parentToolCallIdOf(part) === null;
		if (!isFinalText) {
			break;
		}
		splitIndex = index;
	}
	return {
		activityParts: parts.slice(0, splitIndex),
		finalParts: parts.slice(splitIndex),
	};
}

/**
 * Collect the icon of every row folded into a turn's summary, in the order the
 * turn produced them, so a turn that only injected context still shows a mark
 * rather than an empty chip.
 * @param parts - Message parts to scan
 * @returns One glyph per tool call, skill activation, and injected message
 */
function collectActivityGlyphs(
	parts: UIMessage['parts'],
): readonly ToolGlyph[] {
	return parts.flatMap((part) => {
		if (part.type === 'dynamic-tool') {
			return [glyphForToolCall(part as DynamicToolUIPart)];
		}
		if (skillPartDataOf(part)) {
			return ['biceps-flexed'] as const;
		}
		return customMessageDataOf(part) ? (['puzzle'] as const) : [];
	});
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
