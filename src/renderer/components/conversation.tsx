'use client';

import { ArrowDownIcon } from 'lucide-react';
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
	StickToBottom,
	type StickToBottomContext,
	useStickToBottomContext,
} from 'use-stick-to-bottom';
import {
	ConversationViewportProvider,
	useConversationViewportValue,
} from '@/renderer/components/conversation/viewport-context';
import { Button } from '@/renderer/components/ui/button';
import { ScrollBar } from '@/renderer/components/ui/scroll-area';
import { useConversationFollowKey } from '@/renderer/hooks/conversation/use-conversation-follow-key';
import { useConversationScrollHold } from '@/renderer/hooks/conversation/use-conversation-scroll-hold';
import { useConversationScrollRestore } from '@/renderer/hooks/conversation/use-conversation-scroll-restore';
import { cn } from '@/renderer/lib/utils';

/** Props for the Conversation wrapper — the underlying StickToBottom props. */
type ConversationProps = ComponentProps<typeof StickToBottom>;

/** Provides the sticky chat scroll context for conversation timelines. */
export const Conversation = ({ className, ...props }: ConversationProps) => (
	<StickToBottom
		className={cn('relative flex-1 overflow-y-hidden', className)}
		initial='instant'
		resize='smooth'
		role='log'
		{...props}
	/>
);

/**
 * Props for ConversationContent — the StickToBottom.Content props, plus the
 * key its scroll position is remembered under. Pass a stable per-conversation
 * `scrollKey` (the chat tab id) to have the viewport reopen where the user left
 * it; omit it for one-off surfaces that should always open at the newest
 * message. Changing `followKey` — the count of prompts the user has sent —
 * jumps to the newest message, so sending lands in view from anywhere in the
 * transcript.
 */
type ConversationContentProps = ComponentProps<typeof StickToBottom.Content> & {
	followKey?: string | number;
	scrollKey?: string;
};

/** Renders sticky conversation content inside shadcn scroll-area chrome. */
export const ConversationContent = ({
	children,
	className,
	followKey,
	scrollClassName,
	scrollKey,
	...props
}: ConversationContentProps) => {
	const context = useStickToBottomContext();
	const ready = useConversationScrollRestore({
		scrollKey,
		scrollRef: context.scrollRef,
		scrollState: context.state,
		stopScroll: context.stopScroll,
	});
	useConversationScrollHold({
		contentRef: context.contentRef,
		scrollRef: context.scrollRef,
		scrollState: context.state,
		stopScroll: context.stopScroll,
	});
	useConversationFollowKey({
		followKey,
		scrollToBottom: context.scrollToBottom,
	});
	const viewport = useConversationViewportValue(
		context.scrollRef,
		context.stopScroll,
	);

	return (
		<ConversationViewportProvider value={viewport}>
			<ScrollAreaPrimitive.Root
				className={cn('size-full', scrollClassName)}
				data-slot='conversation-scroll-area'
			>
				<ScrollAreaPrimitive.Viewport
					// Radix wraps children in a `display:table; min-width:100%` div that
					// grows to the widest child's intrinsic width — long unbroken content
					// (e.g. the reasoning preview) then pushes the whole timeline past the
					// right edge. Force that wrapper to a block so its width tracks the
					// viewport and `%`/`max-w` children resolve against the visible area.
					className='[&>div]:block! size-full rounded-[inherit] outline-none transition-[color,box-shadow] focus-visible:outline-1 focus-visible:ring-3 focus-visible:ring-ring/50 [&>div]:min-w-0!'
					data-slot='conversation-scroll-area-viewport'
					ref={context.scrollRef}
					style={{
						opacity: ready ? 1 : 0,
						scrollbarGutter: 'stable both-edges',
					}}
				>
					<div
						className={cn('flex flex-col gap-8 p-4', className)}
						ref={context.contentRef}
						{...props}
					>
						{renderConversationContentChildren(children, context)}
					</div>
				</ScrollAreaPrimitive.Viewport>
				<ScrollBar />
				<ScrollAreaPrimitive.Corner />
			</ScrollAreaPrimitive.Root>
		</ConversationViewportProvider>
	);
};

/** Resolves static or render-prop conversation children against stick context. */
const renderConversationContentChildren = (
	children: ConversationContentProps['children'],
	context: StickToBottomContext,
): ReactNode => {
	if (typeof children === 'function') {
		return children(context);
	}
	return children;
};

/**
 * Props for ConversationScrollButton — the underlying Button props, plus the
 * two boxes that place the floating button. `className` styles the button and
 * cannot move it; the wrapper classes are what position it.
 */
type ConversationScrollButtonProps = ComponentProps<typeof Button> & {
	/** The centered measure inside the inset — the surface's own composer column. */
	columnClassName?: string;
	/** Padding across the panel's full width — the surface's own composer inset. */
	insetClassName?: string;
};

/**
 * Floating squircle that scrolls the conversation to the bottom; hidden while
 * already at the bottom. Its wrapper is two nested boxes repeating whichever
 * pair the surface's composer uses — an inset across the panel's full width,
 * then a centered measure inside it — so the button sits flush with the
 * composer's left edge and mirrors the unread pill anchored to its right. The
 * defaults are the workbench composer's box; a surface laid out differently
 * passes its own, and one with no composer passes its transcript column. The
 * nesting is load-bearing: an inset outside the measure and one inside it put
 * that left edge in different places once the panel outgrows the measure.
 */
export const ConversationScrollButton = ({
	className,
	columnClassName = 'mx-auto w-full max-w-4xl',
	insetClassName = 'px-4',
	...props
}: ConversationScrollButtonProps) => {
	const { t } = useTranslation();
	const { isAtBottom, scrollToBottom } = useStickToBottomContext();

	const handleScrollToBottom = useCallback(() => {
		scrollToBottom();
	}, [scrollToBottom]);

	return (
		!isAtBottom && (
			<div
				className={cn(
					'pointer-events-none absolute inset-x-0 bottom-1',
					insetClassName,
				)}
			>
				<div className={cn('flex', columnClassName)}>
					<Button
						aria-label={t(
							'common:conversation.scroll-to-newest',
							'Scroll to newest message',
						)}
						className={cn(
							'corner-squircle pointer-events-auto rounded-2xl dark:bg-background dark:hover:bg-muted',
							className,
						)}
						onClick={handleScrollToBottom}
						size='icon'
						type='button'
						variant='outline'
						{...props}
					>
						<ArrowDownIcon className='size-4' />
					</Button>
				</div>
			</div>
		)
	);
};
