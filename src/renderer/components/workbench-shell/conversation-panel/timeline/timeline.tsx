import { useQuery } from '@tanstack/react-query';
import type { UIMessage } from 'ai';
import { useCallback, useEffect, useMemo } from 'react';
import {
	piSessionsForWorkspaceQuery,
	turnCheckpointsQuery,
} from '@/renderer/api/ensemblr-queries';
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
import {
	eventsToUIMessages,
	looksLikeStackTrace,
	noticeMetadataOf,
	skillInvocationKey,
	turnMetadataOf,
} from '@/renderer/lib/pi';
import { resolveLiveTurnStartMs } from '@/renderer/lib/workbench/timeline-timing';
import {
	type OptimisticPrompt,
	useOptimisticPrompts,
} from '@/renderer/state/composer';
import type { ChatAssistantTurnTiming } from '@/renderer/types/chat';
import type {
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import { useTurnDiffOpener } from '../file-preview-context';
import { PanelMessage } from '../panel-message';
import { RestoreCheckpointDialog } from './restore-checkpoint-dialog';

/**
 * Structured renderer for the Pi RPC event stream. Reads persisted events
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
		return 'Starting agent…';
	}
	return !state.sessionResolved && state.sessionsFetching
		? 'Loading conversation…'
		: null;
}

export function PiSessionTimeline({
	activePiSessionId,
	activeSession,
	workspace,
}: {
	activePiSessionId: string | null;
	activeSession: SessionTabModel;
	workspace: WorkspaceShellModel;
}) {
	const { data: sessionsData, isFetching: sessionsFetching } = useQuery(
		piSessionsForWorkspaceQuery(workspace.id),
	);
	const tabPiSessionId = activeSession.piSessionId ?? activePiSessionId;
	const activePiSession =
		tabPiSessionId === null
			? undefined
			: sessionsData?.sessions.find((session) => session.id === tabPiSessionId);
	const branchId = activePiSession?.branchId ?? '';
	const piSessionId = activePiSession?.id ?? null;
	// Match the composer's busy definition (`starting || streaming`) so the live
	// working indicator + turn timer appear during the pre-first-token gap and
	// stay mounted for the whole agent run rather than flickering per tool round.
	const isStreaming =
		activePiSession?.status === 'streaming' ||
		activePiSession?.status === 'starting';

	const { error, events } = useTimelineEvents({
		branchId,
		sessionId: piSessionId,
	});

	const fork = useForkConversation({
		branchId,
		sessionId: piSessionId ?? '',
		workspace,
	});
	const canFork = branchId.length > 0 && piSessionId !== null;

	const { data: checkpointsData } = useQuery(turnCheckpointsQuery(piSessionId));
	const checkpointsByTurnId = useMemo(() => {
		const map = new Map<string, { label: string }>();
		for (const checkpoint of checkpointsData?.checkpoints ?? []) {
			if (checkpoint.turnId) {
				map.set(checkpoint.turnId, { label: checkpoint.label });
			}
		}
		return map;
	}, [checkpointsData?.checkpoints]);
	const openTurnDiff = useTurnDiffOpener();
	const restore = useCheckpointRestore();
	// Same-workspace multi-session restores are risky: another live session may
	// have produced later file changes that a restore would clobber.
	const hasOtherOpenSessions = (sessionsData?.sessions ?? []).some(
		(session) => session.id !== piSessionId && session.runtimeOpen,
	);

	const requestRestore = useCallback(
		({ label, turnId }: { label: string; turnId: string }) => {
			if (!piSessionId) {
				return;
			}
			restore.request({ branchId, label, piSessionId, turnId });
		},
		[branchId, piSessionId, restore.request],
	);

	const persistedMessages = useMemo<UIMessage[]>(
		() => eventsToUIMessages(events),
		[events],
	);

	const optimistic = useOptimisticPrompts(activeSession.chatTabId);

	// Drop an optimistic prompt as soon as a persisted user-message with the
	// same text shows up in the event stream. The dedup is text-only and
	// chronologically ordered so back-to-back identical prompts still resolve
	// in submission order.
	useEffect(() => {
		if (optimistic.prompts.length === 0) {
			return;
		}
		const matchedIds = matchOptimisticAgainstMessages(
			optimistic.prompts,
			persistedMessages,
		);
		if (matchedIds.length > 0) {
			optimistic.removeMany(matchedIds);
		}
	}, [optimistic, persistedMessages]);

	const optimisticUnmatched = useMemo(
		() => filterUnmatchedOptimistic(optimistic.prompts, persistedMessages),
		[optimistic.prompts, persistedMessages],
	);

	const messages = useMemo<UIMessage[]>(
		() => [
			...persistedMessages,
			...optimisticUnmatched.map(optimisticToUIMessage),
		],
		[persistedMessages, optimisticUnmatched],
	);

	// Show a live "Working…" indicator in the pre-first-token gap: the turn is
	// streaming but no assistant turn exists yet (trailing message is the user
	// prompt). Anchored at the submit time so it ticks continuously into the
	// streaming turn's own timer once the first event lands.
	const pendingStartMs =
		isStreaming && messages.at(-1)?.role === 'user'
			? resolveLiveTurnStartMs(messages, optimistic.prompts)
			: null;

	if (piSessionId && error) {
		return (
			<section
				aria-label='Pi session timeline'
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
	// and Pi only echoes the prompt back once its child process has booted, so an
	// empty transcript here means "starting", not "nothing to show".
	const startingLabel = resolveStartingLabel({
		hasSession: tabPiSessionId !== null,
		isStreaming,
		sessionResolved: activePiSession !== undefined,
		sessionsFetching,
	});

	if (messages.length === 0) {
		if (startingLabel === null) {
			return null;
		}
		return (
			<section
				aria-label='Pi session timeline'
				className='flex min-h-0 flex-1 flex-col'
				data-timeline-state='starting'
			>
				<PanelMessage message={startingLabel} />
			</section>
		);
	}

	return (
		<section
			aria-label='Pi session timeline'
			className='flex min-h-0 flex-1 flex-col'
			data-timeline-state='ready'
		>
			<Conversation
				className='min-h-0 w-full flex-1'
				key={activeSession.chatTabId}
			>
				<ConversationContent
					className='mx-auto w-full max-w-3xl gap-6 px-4 pt-5 pb-5'
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
 * Convert an optimistic prompt entry into a renderable user UIMessage.
 * @param entry - The optimistic prompt awaiting persistence.
 * @returns The equivalent user-role UIMessage.
 */
function optimisticToUIMessage(entry: OptimisticPrompt): UIMessage {
	return {
		id: entry.id,
		parts: [{ state: 'done', text: entry.prompt, type: 'text' }],
		role: 'user',
	};
}

/**
 * Returns the optimistic-prompt entries that have not yet been mirrored by a
 * persisted user message. Matches on the normalized dedup key rather than the
 * raw text, so a skill prompt reconciles with the `<skill>` block Pi expanded it
 * into, and consumes one persisted message per match so duplicates resolve in
 * submission order.
 * @param optimistic - Prompts submitted locally and not yet reconciled
 * @param persisted - The persisted messages to match against
 * @returns The optimistic entries still awaiting a persisted counterpart
 */
function filterUnmatchedOptimistic(
	optimistic: readonly OptimisticPrompt[],
	persisted: readonly UIMessage[],
): readonly OptimisticPrompt[] {
	if (optimistic.length === 0) {
		return optimistic;
	}
	const remainingByKey = buildPersistedKeyCounts(persisted);
	const unmatched: OptimisticPrompt[] = [];
	for (const entry of optimistic) {
		const key = promptDedupKey(entry.prompt);
		const remaining = remainingByKey.get(key) ?? 0;
		if (remaining === 0) {
			unmatched.push(entry);
			continue;
		}
		remainingByKey.set(key, remaining - 1);
	}
	return unmatched;
}

/**
 * Find the optimistic prompts that a persisted user message now mirrors.
 * @param optimistic - The pending optimistic prompts.
 * @param persisted - The persisted messages to match against.
 * @returns The ids of optimistic prompts that have a persisted match.
 */
function matchOptimisticAgainstMessages(
	optimistic: readonly OptimisticPrompt[],
	persisted: readonly UIMessage[],
): string[] {
	const remainingByKey = buildPersistedKeyCounts(persisted);
	const matched: string[] = [];
	for (const entry of optimistic) {
		const key = promptDedupKey(entry.prompt);
		const remaining = remainingByKey.get(key) ?? 0;
		if (remaining === 0) {
			continue;
		}
		remainingByKey.set(key, remaining - 1);
		matched.push(entry.id);
	}
	return matched;
}

/**
 * Canonicalizes a prompt to the key used to match optimistic prompts against
 * persisted ones. A `/skill:name` invocation and the `<skill>…</skill>` block
 * Pi expands it into share one key; every other prompt keys on its raw text, so
 * a skill prompt reconciles with its persisted expansion instead of lingering
 * as a duplicate bubble.
 * @param text - The prompt text, optimistic or persisted
 * @returns The dedup key for the prompt
 */
function promptDedupKey(text: string): string {
	return skillInvocationKey(text) ?? text;
}

/**
 * Counts persisted user-message dedup keys so duplicates are consumed in
 * submission order without repeated linear scans.
 * @param messages - The persisted messages to tally
 * @returns How many persisted messages carry each dedup key
 */
function buildPersistedKeyCounts(
	messages: readonly UIMessage[],
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const key of collectPersistedUserKeys(messages)) {
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
}

/**
 * Collect the dedup key of each persisted user message, canonicalizing skill
 * expansions so they match the `/skill:name` prompt that produced them.
 * @param messages - The persisted messages to scan.
 * @returns The dedup key of every non-empty user message, in order.
 */
function collectPersistedUserKeys(messages: readonly UIMessage[]): string[] {
	const keys: string[] = [];
	for (const message of messages) {
		if (message.role !== 'user') {
			continue;
		}
		const joined = message.parts
			.flatMap((part) => (part.type === 'text' && part.text ? [part.text] : []))
			.join('\n');
		if (joined.length > 0) {
			keys.push(promptDedupKey(joined));
		}
	}
	return keys;
}

/** Renders one mapped Pi message with chat or diagnostic semantics. */
function TimelineMessage({
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

	const isLiveTurn = isStreaming && isLastMessage;
	const metadata = turnMetadataOf(message);
	// Start at the prompt submit time so the timer covers the whole turn
	// (reasoning + tool calls + final answer); fall back to the first assistant
	// event when the prompt time is unknown (e.g. resumed/legacy sessions).
	const startMs = metadata
		? Date.parse(metadata.promptAt ?? metadata.firstEventAt)
		: Number.NaN;
	const endMs = metadata ? Date.parse(metadata.lastEventAt) : Number.NaN;
	const turnTiming: ChatAssistantTurnTiming = {
		endMs: isLiveTurn || Number.isNaN(endMs) ? null : endMs,
		startMs: Number.isNaN(startMs) ? Date.now() : startMs,
	};
	// Fork boundary = the last persisted event of THIS turn, so forking an
	// earlier turn summarizes only the conversation up to that point.
	const upToOrdinal = metadata?.lastOrdinal;
	const turnId = metadata?.turnId ?? null;
	const checkpoint = turnId ? checkpointsByTurnId.get(turnId) : undefined;

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
				turnId && checkpoint
					? () => onRequestRestore({ label: checkpoint.label, turnId })
					: undefined
			}
			onViewTurnDiff={
				turnId && checkpoint && onViewTurnDiff
					? () => onViewTurnDiff({ label: checkpoint.label, turnId })
					: undefined
			}
			timing={turnTiming}
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
