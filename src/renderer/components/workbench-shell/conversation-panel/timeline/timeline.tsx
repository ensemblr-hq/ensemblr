import { useQuery } from '@tanstack/react-query';
import type { UIMessage } from 'ai';
import { useMemo } from 'react';
import { piSessionsForWorkspaceQuery } from '@/renderer/api/ensemble-queries';
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
	Tool,
	ToolContent,
	ToolHeader,
	ToolInput,
	ToolOutput,
} from '@/renderer/components/ai-elements/tool';
import { eventsToUIMessages } from '@/renderer/lib/pi/event-to-ui-message';
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

	if (events.length === 0) {
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
			<Conversation className='min-h-0 flex-1'>
				<ConversationContent className='gap-6 p-0'>
					{messages.map((message) => (
						<TimelineMessage key={message.id} message={message} />
					))}
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>
		</section>
	);
}

function TimelineMessage({ message }: { message: UIMessage }) {
	return (
		<Message from={message.role}>
			<MessageContent>
				{message.parts.map((part, index) => {
					const key = `${message.id}:${index}`;
					if (part.type === 'text') {
						return <MessageResponse key={key}>{part.text}</MessageResponse>;
					}
					if (part.type === 'reasoning') {
						return (
							<Reasoning defaultOpen={false} key={key}>
								<ReasoningTrigger />
								<ReasoningContent>{part.text}</ReasoningContent>
							</Reasoning>
						);
					}
					if (part.type === 'dynamic-tool') {
						return (
							<Tool defaultOpen={false} key={key}>
								<ToolHeader
									state={part.state}
									toolName={part.toolName}
									type={part.type}
								/>
								<ToolContent>
									{'input' in part && part.input !== undefined ? (
										<ToolInput input={part.input} />
									) : null}
									{'output' in part || 'errorText' in part ? (
										<ToolOutput
											errorText={
												'errorText' in part ? part.errorText : undefined
											}
											output={'output' in part ? part.output : undefined}
										/>
									) : null}
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

export default PiSessionTimeline;
