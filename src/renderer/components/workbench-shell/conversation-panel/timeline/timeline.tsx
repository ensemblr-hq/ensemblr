import { useQuery } from '@tanstack/react-query';
import type { UIMessage } from 'ai';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import type { BundledLanguage } from 'shiki';
import { piSessionsForWorkspaceQuery } from '@/renderer/api/ensemble-queries';
import { CodeBlock } from '@/renderer/components/ai-elements/code-block';
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from '@/renderer/components/ai-elements/conversation';
import {
	Message,
	MessageContent,
	MessageResponse,
} from '@/renderer/components/ai-elements/message';
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from '@/renderer/components/ai-elements/reasoning';
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
} from '@/renderer/components/ai-elements/stack-trace';
import { Terminal } from '@/renderer/components/ai-elements/terminal';
import {
	Tool,
	ToolContent,
	ToolHeader,
	ToolInput,
	ToolOutput,
} from '@/renderer/components/ai-elements/tool';
import { eventsToUIMessages } from '@/renderer/lib/pi/event-to-ui-message';
import {
	classifyToolOutput,
	looksLikeStackTrace,
} from '@/renderer/lib/pi/tool-output-classifier';
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
 * Events are mapped to AI SDK `UIMessage` shape and rendered with
 * ai-elements' `Conversation` + `Message` components so we share UI
 * affordances (sticky scroll, reasoning collapse, tool cards) with the rest
 * of the chat surface.
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

	const { error, events, isLoading } = useTimelineEvents({
		branchId,
		sessionId: piSessionId,
	});

	const messages = useMemo<UIMessage[]>(
		() => eventsToUIMessages(events),
		[events],
	);

	if (!piSessionId) {
		return null;
	}

	if (isLoading && events.length === 0) {
		return (
			<section
				aria-label='Pi session timeline'
				className='flex flex-col gap-2 text-muted-foreground text-xs'
				data-timeline-state='loading'
			>
				<p>Loading timeline…</p>
			</section>
		);
	}

	if (error) {
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
		return (
			<section
				aria-label='Pi session timeline'
				className='flex flex-col items-center gap-2 rounded-md border border-border border-dashed bg-pane/40 p-6 text-center text-muted-foreground text-xs'
				data-timeline-state='idle'
			>
				<p>Pi session is idle. Send a prompt to start the conversation.</p>
			</section>
		);
	}

	return (
		<section
			aria-label='Pi session timeline'
			className='flex min-h-0 flex-1 flex-col'
			data-timeline-state='ready'
		>
			<Conversation className='min-h-0 w-full flex-1'>
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

	return (
		<Message from={message.role}>
			<MessageContent>
				{message.parts.map((part, index) => {
					const key = `${message.id}:${index}`;
					if (part.type === 'text') {
						return <MessageResponse key={key}>{part.text}</MessageResponse>;
					}
					if (part.type === 'reasoning') {
						const isReasoningStreaming =
							isStreaming &&
							isLastMessage &&
							index === lastReasoningPartIndex(message);
						return (
							<Reasoning
								defaultOpen={isReasoningStreaming}
								isStreaming={isReasoningStreaming}
								key={key}
							>
								<ReasoningTrigger />
								<ReasoningContent>{part.text}</ReasoningContent>
							</Reasoning>
						);
					}
					if (part.type === 'dynamic-tool') {
						return (
							<Tool defaultOpen={isToolRunning(part.state)} key={key}>
								<ToolHeader
									state={part.state}
									toolName={part.toolName}
									type={part.type}
								/>
								<ToolContent>
									{'input' in part && part.input !== undefined ? (
										<ToolInput input={part.input} />
									) : null}
									<ToolOutputForPart part={part} />
								</ToolContent>
							</Tool>
						);
					}
					return null;
				})}
			</MessageContent>
		</Message>
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

/** Renders one dynamic tool result with the most specific AI Elements view. */
function ToolOutputForPart({
	part,
}: {
	part: Extract<UIMessage['parts'][number], { type: 'dynamic-tool' }>;
}) {
	if ('errorText' in part && part.errorText) {
		const errorNode = looksLikeStackTrace(part.errorText) ? (
			<StackTraceDiagnostic trace={part.errorText} />
		) : (
			part.errorText
		);
		return <ToolOutput errorText={errorNode} output={undefined} />;
	}

	if (!('output' in part) || part.output === undefined) {
		return null;
	}

	return (
		<ToolOutput
			errorText={undefined}
			output={
				<ToolPayload
					state={part.state}
					toolName={part.toolName}
					value={part.output}
				/>
			}
		/>
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

/** Returns the final reasoning part index so streaming state only marks one block. */
function lastReasoningPartIndex(message: UIMessage): number {
	for (let index = message.parts.length - 1; index >= 0; index -= 1) {
		if (message.parts[index]?.type === 'reasoning') {
			return index;
		}
	}
	return -1;
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
