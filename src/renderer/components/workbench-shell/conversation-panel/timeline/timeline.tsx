import type { UIMessage } from 'ai';
import type { TFunction } from 'i18next';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatAssistantTurn } from '@/renderer/components/chat-assistant-turn';
import { ChatWorkingIndicator } from '@/renderer/components/chat-turn-timer';
import { ChatUserPrompt } from '@/renderer/components/chat-user-prompt';
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from '@/renderer/components/conversation';
import { TextContextMenu } from '@/renderer/components/text-context-menu';
import { useForkConversation } from '@/renderer/hooks/workbench-shell/conversation-panel/use-fork-conversation';
import { useCheckpointRestore } from '@/renderer/hooks/workbench-shell/timeline/use-checkpoint-restore';
import {
	type RuntimeErrorRecovery,
	retryPromptsByMessageId,
	useRuntimeErrorRecovery,
} from '@/renderer/hooks/workbench-shell/timeline/use-runtime-error-recovery';
import { useTimelineEvents } from '@/renderer/hooks/workbench-shell/timeline/use-timeline-events';
import { useTimelineMessages } from '@/renderer/hooks/workbench-shell/timeline/use-timeline-messages';
import { useTimelineSession } from '@/renderer/hooks/workbench-shell/timeline/use-timeline-session';
import {
	failureMetadataOf,
	noticeMetadataOf,
	turnMetadataOf,
} from '@/renderer/lib/agent-timeline';
import { resolveTurnTiming } from '@/renderer/lib/workbench/timeline-timing';
import type {
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import { useTurnDiffOpener } from '../file-preview-context';
import { RestoreCheckpointDialog } from './restore-checkpoint-dialog';
import { RuntimeErrorRow } from './runtime-error-row';
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
 * @param t - Translator from the calling component, so the label follows the UI language.
 * @returns The message to show, or null when there is nothing to stand in for.
 */
function resolveStartingLabel(
	state: {
		hasSession: boolean;
		isStreaming: boolean;
		sessionResolved: boolean;
		sessionsFetching: boolean;
	},
	t: TFunction,
): string | null {
	if (!state.hasSession) {
		return null;
	}
	if (state.isStreaming) {
		return t('workbench:timeline.starting.agent', 'Starting agent');
	}
	return !state.sessionResolved && state.sessionsFetching
		? t('workbench:timeline.starting.loading', 'Loading conversation')
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
	const { t } = useTranslation();
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

	const forkFromEnd = useMemo(
		() => (canFork ? () => fork.forkToNewTab() : null),
		[canFork, fork.forkToNewTab],
	);
	const errorRecovery = useRuntimeErrorRecovery({
		fork: forkFromEnd,
		projectId: workspace.projectId,
		workspaceId: workspace.id,
	});
	const retryPrompts = useMemo(
		() => retryPromptsByMessageId(messages),
		[messages],
	);

	if (agentSessionId && error) {
		return (
			<section
				aria-label={t(
					'workbench:timeline.aria-label',
					'Agent session timeline',
				)}
				className='flex flex-col gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 p-3 text-status-warning text-xs'
				data-timeline-state='errored'
			>
				<p>
					{t(
						'workbench:timeline.load-failed',
						'Could not load timeline events.',
					)}{' '}
					{error instanceof Error ? error.message : null}
				</p>
			</section>
		);
	}

	// An agent-spawned tab has no optimistic prompt to stand in for the real one,
	// and the agent only echoes the prompt back once its child process has
	// booted, so an empty transcript here means "starting", not "nothing to show".
	const startingLabel = resolveStartingLabel(
		{
			hasSession: tabAgentSessionId !== null,
			isStreaming,
			sessionResolved,
			sessionsFetching,
		},
		t,
	);

	if (messages.length === 0) {
		if (startingLabel === null) {
			return null;
		}
		return (
			<section
				aria-label={t(
					'workbench:timeline.aria-label',
					'Agent session timeline',
				)}
				className='flex min-h-0 flex-1 flex-col'
				data-timeline-state='starting'
			>
				<TimelineStartingState label={startingLabel} />
			</section>
		);
	}

	return (
		<section
			aria-label={t('workbench:timeline.aria-label', 'Agent session timeline')}
			className='flex min-h-0 flex-1 flex-col'
			data-timeline-state='ready'
		>
			<TextContextMenu>
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
								errorRecovery={errorRecovery}
								fork={canFork ? fork : null}
								isLastMessage={index === messages.length - 1}
								isStreaming={isStreaming}
								key={message.id}
								message={message}
								onRequestRestore={requestRestore}
								onViewTurnDiff={openTurnDiff}
								retryPrompt={retryPrompts.get(message.id) ?? null}
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
			</TextContextMenu>
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
	errorRecovery,
	fork,
	isLastMessage,
	isStreaming,
	message,
	onRequestRestore,
	onViewTurnDiff,
	retryPrompt,
}: {
	checkpointsByTurnId: ReadonlyMap<string, { label: string }>;
	errorRecovery: RuntimeErrorRecovery;
	fork: ReturnType<typeof useForkConversation> | null;
	isLastMessage: boolean;
	isStreaming: boolean;
	message: UIMessage;
	onRequestRestore: (target: { label: string; turnId: string }) => void;
	onViewTurnDiff: ((input: { label: string; turnId: string }) => void) | null;
	/** The prompt "Send again" re-sends, when this row is an error with one before it. */
	retryPrompt: string | null;
}) {
	if (message.role === 'system') {
		return noticeMetadataOf(message) ? (
			<TurnInterrupted text={textFromMessage(message)} />
		) : (
			<RuntimeDiagnostic
				message={message}
				recovery={errorRecovery}
				retryPrompt={retryPrompt}
			/>
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
			isIncomplete={metadata?.incomplete ?? false}
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

/**
 * Renders a runtime failure outside the normal user/assistant bubble flow, as
 * the designed error row with whichever recoveries its class earns.
 *
 * A row whose metadata the projector could not attach — a message shaped like a
 * diagnostic but built elsewhere — still renders, on its flattened text alone;
 * the classifier reads that text and lands it in the `unknown` class rather
 * than dropping the failure.
 */
function RuntimeDiagnostic({
	message,
	recovery,
	retryPrompt,
}: {
	message: UIMessage;
	recovery: RuntimeErrorRecovery;
	retryPrompt: string | null;
}) {
	const failure = failureMetadataOf(message)?.failure ?? {
		message: textFromMessage(message),
	};

	return (
		<RuntimeErrorRow
			failure={failure}
			handlers={{
				onContinue: recovery.continueTurn,
				onEditPrompt: retryPrompt
					? () => recovery.editPrompt(retryPrompt)
					: undefined,
				onFork: recovery.fork ?? undefined,
				onOpenPermissions: recovery.openPermissions,
				onOpenProviderSettings: recovery.openProviderSettings,
				onRetry: retryPrompt ? () => recovery.retry(retryPrompt) : undefined,
			}}
		/>
	);
}

/** Converts all text parts in a message into one diagnostic string. */
function textFromMessage(message: UIMessage): string {
	return message.parts
		.flatMap((part) => (part.type === 'text' && part.text ? [part.text] : []))
		.join('\n');
}
