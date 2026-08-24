import type { UIMessage } from 'ai';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatAssistantTurn } from '@/renderer/components/chat-assistant-turn';
import { ChatWorkingIndicator } from '@/renderer/components/chat-turn-timer';
import { ChatUserPrompt } from '@/renderer/components/chat-user-prompt';
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from '@/renderer/components/conversation';
import {
	FilePreviewOpenerProvider,
	WorkspacePathResolverProvider,
} from '@/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { useConciergeFilePreview } from '@/renderer/hooks/concierge/use-concierge-file-preview';
import {
	createTimelineProjector,
	turnMetadataOf,
} from '@/renderer/lib/agent-timeline';
import { cn } from '@/renderer/lib/utils';
import {
	resolveLiveTurnStartMs,
	resolveTurnTiming,
} from '@/renderer/lib/workbench/timeline-timing';
import type { AgentSessionEventWire } from '@/shared/ipc/contracts/agent-session';
import type { ConciergeSessionEventWire } from '@/shared/ipc/contracts/concierge';

/**
 * One frame per source event, so the same event always maps to the same object.
 *
 * The projector resumes its fold by pointer equality over the prefix it already
 * folded, and its own decoration caches are keyed on the messages that fold
 * produced. Re-shaping the transcript afresh on every streamed token would defeat
 * both: a 200-event conversation would refold all 200 events per delta, which is
 * the exact cost the projector exists to avoid.
 */
const frames = new WeakMap<ConciergeSessionEventWire, AgentSessionEventWire>();

/**
 * Re-shapes a Concierge event as the frame the shared timeline projector reads.
 *
 * The projector's frame carries `branchId` and `turnId` because a workspace chat
 * forks and checkpoints per turn. The Concierge does neither, so its session id
 * stands in for the branch and the turn is always absent — which is what makes
 * the fork, restore, and turn-diff affordances render as unavailable rather than
 * as broken.
 * @param event - One Concierge transcript event.
 * @returns The same event in the projector's frame shape.
 */
function toTimelineFrame(
	event: ConciergeSessionEventWire,
): AgentSessionEventWire {
	const held = frames.get(event);
	if (held) {
		return held;
	}
	const frame: AgentSessionEventWire = {
		branchId: event.sessionId,
		createdAt: event.createdAt,
		eventType: event.eventType,
		id: event.id,
		ordinal: event.ordinal,
		payload: event.payload,
		stream: event.stream,
		turnId: null,
	};
	frames.set(event, frame);
	return frame;
}

/**
 * Renders one projected message as a prompt or as an agent turn.
 *
 * Memoized because the live turn re-renders on every token, exactly as the
 * workspace timeline's own row is: the projector hands settled turns back
 * unchanged, so without this every earlier turn would re-render alongside the
 * streaming one. `isLiveTurn` is resolved by the caller rather than passed as a
 * transcript-wide `isStreaming` flag, so a settled row's props do not move when
 * the turn below it starts or ends.
 */
const ConciergeTimelineMessage = memo(function ConciergeTimelineMessage({
	isLiveTurn,
	message,
}: {
	isLiveTurn: boolean;
	message: UIMessage;
}) {
	if (message.role === 'user') {
		return <ChatUserPrompt prompt={promptTextOf(message)} />;
	}
	return (
		<ChatAssistantTurn
			isStreaming={isLiveTurn}
			message={message}
			timing={resolveTurnTiming({
				isLiveTurn,
				metadata: turnMetadataOf(message),
			})}
		/>
	);
});

/**
 * The Concierge transcript, rendered with the same turn primitives the workspace
 * chat uses.
 *
 * It composes those primitives directly rather than reusing `AgentSessionTimeline`,
 * which reaches for a workspace through four hooks — forking, checkpoint restore,
 * turn diffs, and runtime-error recovery all address a worktree the Concierge
 * does not have. The shared layer is the projector and the turn components, and
 * both are workspace-free.
 *
 * The one workspace affordance it does mount is the file-preview pair every
 * attachment chip reads: the Concierge names files across every project, and a
 * chip it draws opens the file in the workspace that holds it.
 */
export function ConciergeTimeline({
	centered,
	events,
	isStreaming,
}: {
	/** Constrains the transcript to a readable column, as the maximized panel needs. */
	centered: boolean;
	events: readonly ConciergeSessionEventWire[];
	isStreaming: boolean;
}) {
	const { t } = useTranslation();
	const [projectEvents] = useState(createTimelineProjector);
	const { openFilePreview, resolveFilePath } = useConciergeFilePreview();
	const messages = useMemo<UIMessage[]>(
		() => projectEvents(events.map(toTimelineFrame)),
		[events, projectEvents],
	);
	const pendingStartMs =
		isStreaming && messages.at(-1)?.role === 'user'
			? resolveLiveTurnStartMs(messages, [])
			: null;

	if (messages.length === 0) {
		return (
			<div className='flex flex-1 items-center justify-center px-6 text-center text-muted-foreground text-sm'>
				<p className='max-w-md'>
					{isStreaming
						? t('workbench:concierge.timeline.starting', 'Waking the Concierge')
						: t(
								'workbench:concierge.timeline.empty',
								'Ask about any project, and the Concierge can read it, spawn agents into it, and remember what came of that.',
							)}
				</p>
			</div>
		);
	}

	return (
		<WorkspacePathResolverProvider value={resolveFilePath}>
			<FilePreviewOpenerProvider value={openFilePreview}>
				<Conversation className='flex-1'>
					<ConversationContent
						className={cn(
							'gap-4 px-4 py-3',
							// The same column the workspace transcript uses, so a maximized
							// Concierge reads at the same measure rather than running the full
							// width of a wide display.
							centered && 'mx-auto w-full max-w-3xl gap-6 py-5',
						)}
					>
						{messages.map((message, index) => (
							<ConciergeTimelineMessage
								isLiveTurn={isStreaming && index === messages.length - 1}
								key={message.id}
								message={message}
							/>
						))}
						{pendingStartMs === null ? null : (
							<ChatWorkingIndicator startMs={pendingStartMs} />
						)}
					</ConversationContent>
					<ConversationScrollButton />
				</Conversation>
			</FilePreviewOpenerProvider>
		</WorkspacePathResolverProvider>
	);
}

/**
 * Reads a user message back as the plain prompt text the prompt row renders.
 * @param message - A user-role message from the projector.
 * @returns The concatenated text parts.
 */
function promptTextOf(message: UIMessage): string {
	return message.parts
		.map((part) => (part.type === 'text' ? part.text : ''))
		.join('');
}
