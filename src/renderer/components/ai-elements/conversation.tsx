'use client';

import type { UIMessage } from 'ai';
import { ArrowDownIcon, DownloadIcon } from 'lucide-react';
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { useCallback } from 'react';
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
		initial='smooth'
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

	return (
		<ScrollAreaPrimitive.Root
			className={cn('size-full', scrollClassName)}
			data-slot='conversation-scroll-area'
		>
			<ScrollAreaPrimitive.Viewport
				className='size-full rounded-[inherit] outline-none transition-[color,box-shadow] focus-visible:outline-1 focus-visible:ring-3 focus-visible:ring-ring/50'
				data-slot='conversation-scroll-area-viewport'
				ref={context.scrollRef}
				style={{ scrollbarGutter: 'stable both-edges' }}
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

export type ConversationEmptyStateProps = ComponentProps<'div'> & {
	title?: string;
	description?: string;
	icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
	className,
	title = 'No messages yet',
	description = 'Start a conversation to see messages here',
	icon,
	children,
	...props
}: ConversationEmptyStateProps) => (
	<div
		className={cn(
			'flex size-full flex-col items-center justify-center gap-3 p-8 text-center',
			className,
		)}
		{...props}
	>
		{children ?? (
			<>
				{icon && <div className='text-muted-foreground'>{icon}</div>}
				<div className='space-y-1'>
					<h3 className='font-medium text-sm'>{title}</h3>
					{description && (
						<p className='text-muted-foreground text-sm'>{description}</p>
					)}
				</div>
			</>
		)}
	</div>
);

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

const getMessageText = (message: UIMessage): string =>
	message.parts
		.filter((part) => part.type === 'text')
		.map((part) => part.text)
		.join('');

export type ConversationDownloadProps = Omit<
	ComponentProps<typeof Button>,
	'onClick'
> & {
	messages: UIMessage[];
	filename?: string;
	formatMessage?: (message: UIMessage, index: number) => string;
};

const defaultFormatMessage = (message: UIMessage): string => {
	const roleLabel =
		message.role.charAt(0).toUpperCase() + message.role.slice(1);
	return `**${roleLabel}:** ${getMessageText(message)}`;
};

export const messagesToMarkdown = (
	messages: UIMessage[],
	formatMessage: (
		message: UIMessage,
		index: number,
	) => string = defaultFormatMessage,
): string => messages.map((msg, i) => formatMessage(msg, i)).join('\n\n');

export const ConversationDownload = ({
	messages,
	filename = 'conversation.md',
	formatMessage = defaultFormatMessage,
	className,
	children,
	...props
}: ConversationDownloadProps) => {
	const handleDownload = useCallback(() => {
		const markdown = messagesToMarkdown(messages, formatMessage);
		const blob = new Blob([markdown], { type: 'text/markdown' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		document.body.append(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
	}, [messages, filename, formatMessage]);

	return (
		<Button
			className={cn(
				'absolute top-4 right-4 rounded-full dark:bg-background dark:hover:bg-muted',
				className,
			)}
			onClick={handleDownload}
			size='icon'
			type='button'
			variant='outline'
			{...props}
		>
			{children ?? <DownloadIcon className='size-4' />}
		</Button>
	);
};
