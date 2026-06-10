import { useQuery } from '@tanstack/react-query';
import type { DynamicToolUIPart, UIMessage } from 'ai';
import type { ReactNode } from 'react';
import { useEffect, useMemo } from 'react';
import type { BundledLanguage } from 'shiki';
import { piSessionsForWorkspaceQuery } from '@/renderer/api/ensemble-queries';
import {
	ChatAssistantTurn,
	type ChatAssistantTurnTiming,
} from '@/renderer/components/chat-assistant-turn';
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
import {
	classifyToolOutput,
	eventsToUIMessages,
	looksLikeStackTrace,
	turnMetadataOf,
} from '@/renderer/lib/pi';
import {
	type OptimisticPrompt,
	useOptimisticPrompts,
} from '@/renderer/state/optimistic-prompts';
import type {
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import { useTimelineEvents } from './use-timeline-events';

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
	const sessionsQuery = useQuery(piSessionsForWorkspaceQuery(workspace.id));
	const tabPiSessionId = activeSession.piSessionId ?? activePiSessionId;
	const activePiSession =
		tabPiSessionId === null
			? undefined
			: sessionsQuery.data?.sessions.find(
					(session) => session.id === tabPiSessionId,
				);
	const branchId = activePiSession?.branchId ?? '';
	const piSessionId = activePiSession?.id ?? null;
	const isStreaming = activePiSession?.status === 'streaming';

	const { error, events } = useTimelineEvents({
		branchId,
		sessionId: piSessionId,
	});

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
							isLastMessage={index === messages.length - 1}
							isStreaming={isStreaming}
							key={message.id}
							message={message}
						/>
					))}
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>
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
	const persistedTexts = collectPersistedUserTexts(persisted);
	const unmatched: OptimisticPrompt[] = [];
	for (const entry of optimistic) {
		const found = persistedTexts.indexOf(entry.prompt);
		if (found === -1) {
			unmatched.push(entry);
			continue;
		}
		persistedTexts.splice(found, 1);
	}
	return unmatched;
}

function matchOptimisticAgainstMessages(
	optimistic: readonly OptimisticPrompt[],
	persisted: readonly UIMessage[],
): string[] {
	const persistedTexts = collectPersistedUserTexts(persisted);
	const matched: string[] = [];
	for (const entry of optimistic) {
		const found = persistedTexts.indexOf(entry.prompt);
		if (found === -1) {
			continue;
		}
		persistedTexts.splice(found, 1);
		matched.push(entry.id);
	}
	return matched;
}

function collectPersistedUserTexts(messages: readonly UIMessage[]): string[] {
	const texts: string[] = [];
	for (const message of messages) {
		if (message.role !== 'user') {
			continue;
		}
		const joined = message.parts
			.map((part) => (part.type === 'text' ? part.text : ''))
			.filter(Boolean)
			.join('\n');
		if (joined.length > 0) {
			texts.push(joined);
		}
	}
	return texts;
}

/** Renders one mapped Pi message with chat or diagnostic semantics. */
function TimelineMessage({
	isLastMessage,
	isStreaming,
	message,
}: {
	isLastMessage: boolean;
	isStreaming: boolean;
	message: UIMessage;
}) {
	if (message.role === 'system') {
		return <RuntimeDiagnostic message={message} />;
	}

	if (message.role === 'user') {
		return <ChatUserPrompt prompt={textFromMessage(message)} />;
	}

	const isLiveTurn = isStreaming && isLastMessage;
	const metadata = turnMetadataOf(message);
	const startMs = metadata ? Date.parse(metadata.firstEventAt) : Number.NaN;
	const endMs = metadata ? Date.parse(metadata.lastEventAt) : Number.NaN;
	const turnTiming: ChatAssistantTurnTiming = {
		endMs: isLiveTurn || Number.isNaN(endMs) ? null : endMs,
		startMs: Number.isNaN(startMs) ? Date.now() : startMs,
	};

	return (
		<ChatAssistantTurn
			isStreaming={isLiveTurn}
			message={message}
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

	return (
		<div className='rounded-md border border-status-warning/30 bg-status-warning/10 p-3 text-xs'>
			{isStackTrace ? (
				<StackTraceDiagnostic trace={text} />
			) : (
				<MessageResponse className='text-status-warning'>
					{text}
				</MessageResponse>
			)}
		</div>
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
		.map((part) => (part.type === 'text' ? part.text : ''))
		.filter(Boolean)
		.join('\n');
}

/** Detects tool states that still represent active work. */
function isToolRunning(state: string): boolean {
	return state === 'input-available' || state === 'input-streaming';
}

export default PiSessionTimeline;
