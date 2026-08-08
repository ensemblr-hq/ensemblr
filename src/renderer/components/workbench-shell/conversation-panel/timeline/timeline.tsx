import type { UIMessage } from 'ai';
import { memo, useCallback } from 'react';
import { ChatAssistantTurn } from '@/renderer/components/chat-assistant-turn';
import { ChatWorkingIndicator } from '@/renderer/components/chat-turn-timer';
import { ChatUserPrompt } from '@/renderer/components/chat-user-prompt';
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from '@/renderer/components/conversation';
import { StackTraceDiagnostic } from '@/renderer/components/stack-trace-diagnostic';
import { useForkConversation } from '@/renderer/hooks/workbench-shell/conversation-panel/use-fork-conversation';
import { useCheckpointRestore } from '@/renderer/hooks/workbench-shell/timeline/use-checkpoint-restore';
import { useTimelineEvents } from '@/renderer/hooks/workbench-shell/timeline/use-timeline-events';
import { useTimelineMessages } from '@/renderer/hooks/workbench-shell/timeline/use-timeline-messages';
import { useTimelineSession } from '@/renderer/hooks/workbench-shell/timeline/use-timeline-session';
import {
	looksLikeStackTrace,
	noticeMetadataOf,
	turnMetadataOf,
} from '@/renderer/lib/agent-timeline';
import type { ChatAssistantTurnTiming } from '@/renderer/types/chat';
import type {
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import { useTurnDiffOpener } from '../file-preview-context';
import { RestoreCheckpointDialog } from './restore-checkpoint-dialog';
import { TimelineStartingState } from './timeline-starting-state';

/**
 * Structured renderer for the agent session event stream. Reads persisted events
 * from SQLite and overlays live events broadcast from the main process so
 * the conversation surface stays in sync without a refresh.
 *
 * Events are mapped to AI SDK `UIMessage` shape and rendered with the
 * shared `Conversation` + `Message` primitives so we get sticky scroll,
 * reasoning collapse, and tool cards across the chat surface.
 */
/**
 * Picks the stand-in an empty transcript shows, or null to render nothing. A tab
 * whose session the list has not caught up with is still loading — but only while
 * that list is in flight, because a session that stays missing after the fetch
 * settles is gone, and a spinner that never resolves is worse than a blank panel.
 * @param state - Whether the tab is bound, whether its session resolved, whether the session list is in flight, and whether the turn is live.
 * @returns The message to show, or null when there is nothing to stand in for.
 */
function resolveStartingLabel(state: {
	hasSession: boolean;
	isStreaming: boolean;
	sessionResolved: boolean;
	sessionsFetching: boolean;
}): string | null {
	if (!state.hasSession) {
		return null;
	}
	if (state.isStreaming) {
		return 'Starting agent';
	}
	return !state.sessionResolved && state.sessionsFetching
		? 'Loading conversation'
		: null;
}

export function AgentSessionTimeline({
	activeAgentSessionId,
	activeSession,
	workspace,
}: {
	activeAgentSessionId: string | null;
	activeSession: SessionTabModel;
	workspace: WorkspaceShellModel;
}) {
	const {
		branchId,
		checkpointsByTurnId,
		hasOtherOpenSessions,
		isStreaming,
		agentSessionId,
		sessionResolved,
		sessionsFetching,
		tabAgentSessionId,
	} = useTimelineSession({ activeAgentSessionId, activeSession, workspace });

	const { error, events } = useTimelineEvents({
		branchId,
		sessionId: agentSessionId,
	});

	const fork = useForkConversation({
		branchId,
		sessionId: agentSessionId ?? '',
		workspace,
	});
	const canFork = branchId.length > 0 && agentSessionId !== null;

	const openTurnDiff = useTurnDiffOpener();
	const restore = useCheckpointRestore();

	const requestRestore = useCallback(
		({ label, turnId }: { label: string; turnId: string }) => {
			if (!agentSessionId) {
				return;
			}
			restore.request({ branchId, label, agentSessionId, turnId });
		},
		[branchId, agentSessionId, restore.request],
	);

	const { messages, pendingStartMs, promptCount } = useTimelineMessages({
		chatTabId: activeSession.chatTabId,
		events,
		isStreaming,
	});

	if (agentSessionId && error) {
		return (
			<section
				aria-label='Agent session timeline'
				className='flex flex-col gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 p-3 text-status-warning text-xs'
				data-timeline-state='errored'
			>
				<p>
					Could not load timeline events.{' '}
					{error instanceof Error ? error.message : null}
				</p>
			</section>
		);
	}

	// An agent-spawned tab has no optimistic prompt to stand in for the real one,
	// and the agent only echoes the prompt back once its child process has
	// booted, so an empty transcript here means "starting", not "nothing to show".
	const startingLabel = resolveStartingLabel({
		hasSession: tabAgentSessionId !== null,
		isStreaming,
		sessionResolved,
		sessionsFetching,
	});

	if (messages.length === 0) {
		if (startingLabel === null) {
			return null;
		}
		return (
			<section
				aria-label='Agent session timeline'
				className='flex min-h-0 flex-1 flex-col'
				data-timeline-state='starting'
			>
				<TimelineStartingState label={startingLabel} />
			</section>
		);
	}

	return (
		<section
			aria-label='Agent session timeline'
			className='flex min-h-0 flex-1 flex-col'
			data-timeline-state='ready'
		>
			<Conversation
				className='min-h-0 w-full flex-1'
				key={activeSession.chatTabId}
			>
				<ConversationContent
					className='mx-auto w-full max-w-3xl gap-6 px-4 pt-5 pb-5'
					followKey={promptCount}
					scrollKey={activeSession.chatTabId}
				>
					{messages.map((message, index) => (
						<TimelineMessage
							checkpointsByTurnId={checkpointsByTurnId}
							fork={canFork ? fork : null}
							isLastMessage={index === messages.length - 1}
							isStreaming={isStreaming}
							key={message.id}
							message={message}
							onRequestRestore={requestRestore}
							onViewTurnDiff={openTurnDiff}
						/>
					))}
					{pendingStartMs !== null ? (
						<div
							className='flex w-full flex-col gap-2.5 text-foreground'
							data-role='assistant-turn'
							data-pending='true'
						>
							<ChatWorkingIndicator startMs={pendingStartMs} />
						</div>
					) : null}
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>
			<RestoreCheckpointDialog
				hasOtherOpenSessions={hasOtherOpenSessions}
				onCancel={restore.cancel}
				onConfirm={() => void restore.confirm()}
				target={restore.target}
			/>
		</section>
	);
}

/**
 * Renders one mapped agent message with chat or diagnostic semantics.
 *
 * Memoized because the live turn re-renders on every token: the projector hands
 * settled turns back unchanged, so without this every earlier turn in the
 * transcript would re-split its parts and re-render alongside the streaming one.
 */
const TimelineMessage = memo(function TimelineMessage({
	checkpointsByTurnId,
	fork,
	isLastMessage,
	isStreaming,
	message,
	onRequestRestore,
	onViewTurnDiff,
}: {
	checkpointsByTurnId: ReadonlyMap<string, { label: string }>;
	fork: ReturnType<typeof useForkConversation> | null;
	isLastMessage: boolean;
	isStreaming: boolean;
	message: UIMessage;
	onRequestRestore: (target: { label: string; turnId: string }) => void;
	onViewTurnDiff: ((input: { label: string; turnId: string }) => void) | null;
}) {
	if (message.role === 'system') {
		return noticeMetadataOf(message) ? (
			<TurnInterrupted text={textFromMessage(message)} />
		) : (
			<RuntimeDiagnostic message={message} />
		);
	}

	if (message.role === 'user') {
		return <ChatUserPrompt prompt={textFromMessage(message)} />;
	}

	return (
		<AssistantTimelineTurn
			checkpointsByTurnId={checkpointsByTurnId}
			fork={fork}
			isLiveTurn={isStreaming && isLastMessage}
			message={message}
			onRequestRestore={onRequestRestore}
			onViewTurnDiff={onViewTurnDiff}
		/>
	);
});

/** Renders one assistant turn with its fork, restore, and turn-diff affordances. */
function AssistantTimelineTurn({
	checkpointsByTurnId,
	fork,
	isLiveTurn,
	message,
	onRequestRestore,
	onViewTurnDiff,
}: {
	checkpointsByTurnId: ReadonlyMap<string, { label: string }>;
	fork: ReturnType<typeof useForkConversation> | null;
	isLiveTurn: boolean;
	message: UIMessage;
	onRequestRestore: (target: { label: string; turnId: string }) => void;
	onViewTurnDiff: ((input: { label: string; turnId: string }) => void) | null;
}) {
	const metadata = turnMetadataOf(message);
	// Fork boundary = the last persisted event of THIS turn, so forking an
	// earlier turn summarizes only the conversation up to that point.
	const upToOrdinal = metadata?.lastOrdinal;
	const turnId = metadata?.turnId ?? null;
	const checkpoint = turnId ? checkpointsByTurnId.get(turnId) : undefined;
	const checkpointTarget =
		turnId && checkpoint ? { label: checkpoint.label, turnId } : null;

	return (
		<ChatAssistantTurn
			forkDisabled={fork?.isForking ?? false}
			isStreaming={isLiveTurn}
			message={message}
			onForkToNewTab={fork ? () => fork.forkToNewTab(upToOrdinal) : undefined}
			onForkToNewWorkspace={
				fork ? () => fork.forkToNewWorkspace(upToOrdinal) : undefined
			}
			onRestoreToCheckpoint={
				checkpointTarget ? () => onRequestRestore(checkpointTarget) : undefined
			}
			onViewTurnDiff={
				checkpointTarget && onViewTurnDiff
					? () => onViewTurnDiff(checkpointTarget)
					: undefined
			}
			timing={resolveTurnTiming({ isLiveTurn, metadata })}
		/>
	);
}

/**
 * Resolve the window the turn timer counts over. It starts at the prompt submit
 * time so the timer covers the whole turn (reasoning + tool calls + final
 * answer), falling back to the first assistant event when the prompt time is
 * unknown (resumed or legacy sessions). A live turn has no end yet.
 * @param isLiveTurn - Whether this turn is still streaming
 * @param metadata - Turn metadata carried on the message, if any
 * @returns The timing window handed to the assistant turn
 */
function resolveTurnTiming({
	isLiveTurn,
	metadata,
}: {
	isLiveTurn: boolean;
	metadata: ReturnType<typeof turnMetadataOf>;
}): ChatAssistantTurnTiming {
	const startMs = metadata
		? Date.parse(metadata.promptAt ?? metadata.firstEventAt)
		: Number.NaN;
	const endMs = metadata ? Date.parse(metadata.lastEventAt) : Number.NaN;
	return {
		endMs: isLiveTurn || Number.isNaN(endMs) ? null : endMs,
		startMs: Number.isNaN(startMs) ? Date.now() : startMs,
	};
}

/**
 * Renders the marker left where the user stopped a turn: a hairline rule with a
 * quiet centered label, so an interruption reads as a deliberate boundary in the
 * conversation rather than as a failure.
 */
function TurnInterrupted({ text }: { text: string }) {
	return (
		<div
			className='flex items-center gap-3 text-muted-foreground/70 text-xs'
			data-role='turn-interrupted'
		>
			<span className='h-px flex-1 bg-border/60' />
			<span>{text}</span>
			<span className='h-px flex-1 bg-border/60' />
		</div>
	);
}

/** Renders runtime failures outside the normal user/assistant bubble flow. */
function RuntimeDiagnostic({ message }: { message: UIMessage }) {
	const text = textFromMessage(message);
	const isStackTrace = looksLikeStackTrace(text);

	// Stack traces still need a container to stay legible; plain runtime errors
	// render as a lean inline line — no box — per the timeline's quiet style.
	if (isStackTrace) {
		return (
			<div className='rounded-md border border-status-warning/30 bg-status-warning/10 p-3 text-xs'>
				<StackTraceDiagnostic
					className='border-status-warning/30'
					trace={text}
				/>
			</div>
		);
	}

	return <p className='px-1 text-status-warning text-xs'>{text}</p>;
}

/** Converts all text parts in a message into one diagnostic string. */
function textFromMessage(message: UIMessage): string {
	return message.parts
		.flatMap((part) => (part.type === 'text' && part.text ? [part.text] : []))
		.join('\n');
}
