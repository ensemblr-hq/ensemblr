'use client';

import { ArrowDownIcon } from 'lucide-react';
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { useCallback, useLayoutEffect, useState } from 'react';
import {
	StickToBottom,
	type StickToBottomContext,
	useStickToBottomContext,
} from 'use-stick-to-bottom';
import { Button } from '@/renderer/components/ui/button';
import { ScrollBar } from '@/renderer/components/ui/scroll-area';
import { cn } from '@/renderer/lib/utils';

export type ConversationProps = ComponentProps<typeof StickToBottom>;

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

export type ConversationContentProps = ComponentProps<
	typeof StickToBottom.Content
>;

/** Renders sticky conversation content inside shadcn scroll-area chrome. */
export const ConversationContent = ({
	children,
	className,
	scrollClassName,
	...props
}: ConversationContentProps) => {
	const context = useStickToBottomContext();
	const [ready, setReady] = useState(false);

	// Jam scrollTop to the bottom before the first paint and only reveal the
	// viewport once it lands there. The library's own initial scroll fires in
	// a useEffect (post-paint), so without this the user briefly sees the top
	// of long conversations on tab switch.
	useLayoutEffect(() => {
		const node = context.scrollRef.current;
		if (node) {
			node.scrollTop = node.scrollHeight;
		}
		setReady(true);
	}, [context.scrollRef]);

	return (
		<ScrollAreaPrimitive.Root
			className={cn('size-full', scrollClassName)}
			data-slot='conversation-scroll-area'
		>
			<ScrollAreaPrimitive.Viewport
				className='size-full rounded-[inherit] outline-none transition-[color,box-shadow] focus-visible:outline-1 focus-visible:ring-3 focus-visible:ring-ring/50'
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

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
	className,
	...props
}: ConversationScrollButtonProps) => {
	const { isAtBottom, scrollToBottom } = useStickToBottomContext();

	const handleScrollToBottom = useCallback(() => {
		scrollToBottom();
	}, [scrollToBottom]);

	return (
		!isAtBottom && (
			<Button
				className={cn(
					'absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full dark:bg-background dark:hover:bg-muted',
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
		)
	);
};
