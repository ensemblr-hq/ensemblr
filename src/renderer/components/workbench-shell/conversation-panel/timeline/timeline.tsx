import { useQuery } from '@tanstack/react-query';
import type { DynamicToolUIPart, UIMessage } from 'ai';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo } from 'react';
import type { BundledLanguage } from 'shiki';
import {
	piSessionsForWorkspaceQuery,
	turnCheckpointsQuery,
} from '@/renderer/api/ensemble-queries';
import {
	ChatAssistantTurn,
	type ChatAssistantTurnTiming,
} from '@/renderer/components/chat-assistant-turn';
import { ChatWorkingIndicator } from '@/renderer/components/chat-turn-timer';
import { ChatUserPrompt } from '@/renderer/components/chat-user-prompt';
import { CodeBlock } from '@/renderer/components/code-block';
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from '@/renderer/components/conversation';
import { MessageResponse } from '@/renderer/components/message';
import {
	StackTrace,
	StackTraceActions,
	StackTraceContent,
	StackTraceCopyButton,
	StackTraceError,
	StackTraceErrorMessage,
	StackTraceErrorType,
	StackTraceExpandButton,
	StackTraceFrames,
	StackTraceHeader,
} from '@/renderer/components/stack-trace';
import { Terminal } from '@/renderer/components/terminal';
import { useForkConversation } from '@/renderer/hooks/workbench-shell/conversation-panel/use-fork-conversation';
import { useCheckpointRestore } from '@/renderer/hooks/workbench-shell/timeline/use-checkpoint-restore';
import { useTimelineEvents } from '@/renderer/hooks/workbench-shell/timeline/use-timeline-events';
import {
	classifyToolOutput,
	eventsToUIMessages,
	looksLikeStackTrace,
	turnMetadataOf,
} from '@/renderer/lib/pi';
import {
	type OptimisticPrompt,
	useOptimisticPrompts,
} from '@/renderer/state/composer';
import type {
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import { useTurnDiffOpener } from '../file-preview-context';
import { RestoreCheckpointDialog } from './restore-checkpoint-dialog';
import { resolveLiveTurnStartMs } from './timeline-timing';

/**
 * Structured renderer for the Pi RPC event stream. Reads persisted events
 * from SQLite and overlays live events broadcast from the main process so
 * the conversation surface stays in sync without a refresh.
 *
 * Events are mapped to AI SDK `UIMessage` shape and rendered with the
 * shared `Conversation` + `Message` primitives so we get sticky scroll,
 * reasoning collapse, and tool cards across the chat surface.
 */
export function PiSessionTimeline({
	activePiSessionId,
	activeSession,
	workspace,
}: {
	activePiSessionId: string | null;
	activeSession: SessionTabModel;
	workspace: WorkspaceShellModel;
}) {
	const { data: sessionsData } = useQuery(
		piSessionsForWorkspaceQuery(workspace.id),
	);
	const tabPiSessionId = activeSession.piSessionId ?? activePiSessionId;
	const activePiSession =
		tabPiSessionId === null
			? undefined
			: sessionsData?.sessions.find((session) => session.id === tabPiSessionId);
	const branchId = activePiSession?.branchId ?? '';
	const piSessionId = activePiSession?.id ?? null;
	const isStreaming = activePiSession?.status === 'streaming';

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

	if (messages.length === 0) {
		return null;
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
				<ConversationContent className='mx-auto w-full max-w-3xl gap-6 px-4 pt-5 pb-5'>
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

function optimisticToUIMessage(entry: OptimisticPrompt): UIMessage {
	return {
		id: entry.id,
		parts: [{ state: 'done', text: entry.prompt, type: 'text' }],
		role: 'user',
	};
}

/**
 * Returns the optimistic-prompt entries that have not yet been mirrored by a
 * persisted user message. Match is exact on `prompt` text and consumes one
 * persisted message per match so duplicates resolve in submission order.
 */
function filterUnmatchedOptimistic(
	optimistic: readonly OptimisticPrompt[],
	persisted: readonly UIMessage[],
): readonly OptimisticPrompt[] {
	if (optimistic.length === 0) {
		return optimistic;
	}
	const remainingByText = buildPersistedTextCounts(persisted);
	const unmatched: OptimisticPrompt[] = [];
	for (const entry of optimistic) {
		const remaining = remainingByText.get(entry.prompt) ?? 0;
		if (remaining === 0) {
			unmatched.push(entry);
			continue;
		}
		remainingByText.set(entry.prompt, remaining - 1);
	}
	return unmatched;
}

function matchOptimisticAgainstMessages(
	optimistic: readonly OptimisticPrompt[],
	persisted: readonly UIMessage[],
): string[] {
	const remainingByText = buildPersistedTextCounts(persisted);
	const matched: string[] = [];
	for (const entry of optimistic) {
		const remaining = remainingByText.get(entry.prompt) ?? 0;
		if (remaining === 0) {
			continue;
		}
		remainingByText.set(entry.prompt, remaining - 1);
		matched.push(entry.id);
	}
	return matched;
}

/**
 * Counts persisted user-message texts so duplicates are consumed in submission
 * order without repeated linear scans.
 */
function buildPersistedTextCounts(
	messages: readonly UIMessage[],
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const text of collectPersistedUserTexts(messages)) {
		counts.set(text, (counts.get(text) ?? 0) + 1);
	}
	return counts;
}

function collectPersistedUserTexts(messages: readonly UIMessage[]): string[] {
	const texts: string[] = [];
	for (const message of messages) {
		if (message.role !== 'user') {
			continue;
		}
		const joined = message.parts
			.flatMap((part) => (part.type === 'text' && part.text ? [part.text] : []))
			.join('\n');
		if (joined.length > 0) {
			texts.push(joined);
		}
	}
	return texts;
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
		return <RuntimeDiagnostic message={message} />;
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
			renderToolDetail={(part) => renderToolDetailNode(part)}
			timing={turnTiming}
		/>
	);
}

function renderToolDetailNode(part: DynamicToolUIPart): ReactNode {
	if ('errorText' in part && part.errorText) {
		const errorText = part.errorText;
		return looksLikeStackTrace(errorText) ? (
			<StackTraceDiagnostic trace={errorText} />
		) : (
			<MessageResponse className='text-status-warning'>
				{errorText}
			</MessageResponse>
		);
	}
	if (!('output' in part) || part.output === undefined) {
		return null;
	}
	return (
		<ToolPayload
			state={part.state}
			toolName={part.toolName}
			value={part.output}
		/>
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
				<StackTraceDiagnostic trace={text} />
			</div>
		);
	}

	return (
		<p className='px-1 text-status-warning text-xs'>{text}</p>
	);
}

/** Memoised payload renderer — classification runs once per (value, toolName). */
function ToolPayload({
	state,
	toolName,
	value,
}: {
	state: string;
	toolName: string;
	value: unknown;
}): ReactNode {
	const classification = useMemo(
		() => classifyToolOutput(toolName, value),
		[toolName, value],
	);

	switch (classification.kind) {
		case 'stack-trace':
			return <StackTraceDiagnostic trace={classification.text} />;
		case 'terminal':
			return (
				<Terminal
					isStreaming={isToolRunning(state)}
					output={classification.text}
				/>
			);
		case 'code':
			return (
				<CodeBlock
					code={classification.text}
					language={classification.language ?? 'typescript'}
				/>
			);
		case 'path-tree':
			return (
				<CodeBlock
					code={classification.text}
					language={'text' as BundledLanguage}
				/>
			);
		case 'json':
			return <CodeBlock code={classification.text} language='json' />;
		case 'text':
			return <MessageResponse>{classification.text}</MessageResponse>;
		default: {
			const exhaustive: never = classification.kind;
			void exhaustive;
			return <MessageResponse>{classification.text}</MessageResponse>;
		}
	}
}

/** Renders a collapsed stack trace diagnostic from generated AI Elements parts. */
function StackTraceDiagnostic({ trace }: { trace: string }) {
	return (
		<StackTrace
			className='border-status-warning/30'
			defaultOpen={false}
			trace={trace}
		>
			<StackTraceHeader>
				<StackTraceError>
					<StackTraceErrorType />
					<StackTraceErrorMessage />
				</StackTraceError>
				<StackTraceActions>
					<StackTraceCopyButton />
					<StackTraceExpandButton />
				</StackTraceActions>
			</StackTraceHeader>
			<StackTraceContent>
				<StackTraceFrames showInternalFrames={false} />
			</StackTraceContent>
		</StackTrace>
	);
}

/** Converts all text parts in a message into one diagnostic string. */
function textFromMessage(message: UIMessage): string {
	return message.parts
		.flatMap((part) => (part.type === 'text' && part.text ? [part.text] : []))
		.join('\n');
}

/** Detects tool states that still represent active work. */
function isToolRunning(state: string): boolean {
	return state === 'input-available' || state === 'input-streaming';
}
