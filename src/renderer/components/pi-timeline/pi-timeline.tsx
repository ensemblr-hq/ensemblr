import { ChatMessageText } from '@/renderer/components/chat-message-text';
import { ChatUserPrompt } from '@/renderer/components/chat-user-prompt';
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from '@/renderer/components/conversation';
import { cn } from '@/renderer/lib/utils';
import type {
	PiTimelineItem,
	PiTimelineState,
} from '@/renderer/types/pi-timeline';

import { PiThinkingRow } from './pi-thinking-row.tsx';
import { PiToolCard } from './pi-tool-card.tsx';
import { PiToolGroupCard } from './pi-tool-group-card.tsx';
import { PiLiveTurnFooter, PiTurnFooter } from './pi-turn-footer.tsx';

/**
 * Conversation timeline rendered straight from the reducer state. Scrolling
 * uses the shared StickToBottom conversation (auto-follows while streaming,
 * stops the moment the user scrolls up, "jump to latest" pill via
 * ConversationScrollButton). Instead of a windowing library, every item is
 * wrapped in a `content-visibility: auto` container so the browser skips
 * layout/paint for offscreen rows — long sessions stay smooth without
 * breaking sticky-scroll anchoring or item-internal state.
 */
export function PiTimeline({
	className,
	state,
}: {
	className?: string;
	state: PiTimelineState;
}) {
	const { items, session } = state;
	return (
		<Conversation className={cn('min-h-0 w-full flex-1', className)}>
			<ConversationContent className='mx-auto flex w-full max-w-3xl flex-col px-4 pt-5 pb-5'>
				{items.map((item, index) => (
					<PiTimelineItemView isFirst={index === 0} item={item} key={item.id} />
				))}
				{session.streaming && session.turnStartedAtMs !== null ? (
					<PiLiveTurnFooter
						className='mt-2'
						startedAtMs={session.turnStartedAtMs}
					/>
				) : null}
			</ConversationContent>
			<ConversationScrollButton />
		</Conversation>
	);
}

/**
 * Renders one timeline item with turn-aware spacing: generous gaps around
 * user prompts and turn footers (turn boundaries), tight gaps between the
 * activity rows inside a turn.
 */
function PiTimelineItemView({
	isFirst,
	item,
}: {
	isFirst: boolean;
	item: PiTimelineItem;
}) {
	return (
		<div
			className={cn(
				'[contain-intrinsic-size:auto_3rem] [content-visibility:auto]',
				itemSpacing(item, isFirst),
			)}
		>
			<PiTimelineItemBody item={item} />
		</div>
	);
}

function itemSpacing(item: PiTimelineItem, isFirst: boolean): string {
	if (item.kind === 'user-message') {
		return isFirst ? '' : 'mt-8';
	}
	if (item.kind === 'turn-footer') {
		return 'mt-2';
	}
	if (item.kind === 'assistant-message') {
		return 'mt-3';
	}
	return 'mt-1.5';
}

function PiTimelineItemBody({ item }: { item: PiTimelineItem }) {
	switch (item.kind) {
		case 'user-message':
			return <ChatUserPrompt prompt={item.text} />;
		case 'assistant-message':
			return (
				<div
					className='text-sm'
					data-kind='assistant-message'
					data-role='timeline-item'
				>
					<ChatMessageText text={item.text} />
					{item.streaming ? (
						// Reserved caret keeps the streaming row height stable so new
						// deltas never reflow the line above.
						<span
							aria-hidden='true'
							className='ml-0.5 inline-block h-4 w-0.5 animate-pulse rounded-xs bg-foreground/70 align-text-bottom'
						/>
					) : null}
				</div>
			);
		case 'thinking':
			return <PiThinkingRow item={item} />;
		case 'tool-call':
			return <PiToolCard call={item} />;
		case 'tool-group':
			return <PiToolGroupCard group={item} />;
		case 'turn-footer':
			return <PiTurnFooter item={item} />;
		default: {
			const exhaustive: never = item;
			void exhaustive;
			return null;
		}
	}
}
