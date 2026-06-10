'use client';

import type { DynamicToolUIPart, ToolUIPart } from 'ai';
import {
	CheckCircleIcon,
	ChevronDownIcon,
	CircleIcon,
	ClockIcon,
	WrenchIcon,
	XCircleIcon,
} from 'lucide-react';
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { isValidElement } from 'react';
import { Badge } from '@/renderer/components/ui/badge';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/renderer/components/ui/collapsible';
import { ScrollBar } from '@/renderer/components/ui/scroll-area';
import { cn } from '@/renderer/lib/utils';

import { CodeBlock } from './code-block';

export type ToolProps = ComponentProps<typeof Collapsible>;

/** Wraps a tool call in a collapsible card. */
export const Tool = ({ className, ...props }: ToolProps) => (
	<Collapsible
		className={cn('group not-prose mb-4 w-full rounded-md border', className)}
		{...props}
	/>
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolHeaderProps = {
	title?: string;
	className?: string;
} & (
	| { type: ToolUIPart['type']; state: ToolUIPart['state']; toolName?: never }
	| {
			type: DynamicToolUIPart['type'];
			state: DynamicToolUIPart['state'];
			toolName: string;
	  }
);

const statusLabels: Record<ToolPart['state'], string> = {
	'approval-requested': 'Awaiting Approval',
	'approval-responded': 'Responded',
	'input-available': 'Running',
	'input-streaming': 'Pending',
	'output-available': 'Completed',
	'output-denied': 'Denied',
	'output-error': 'Error',
};

const statusIcons: Record<ToolPart['state'], ReactNode> = {
	'approval-requested': <ClockIcon className='size-4 text-yellow-600' />,
	'approval-responded': <CheckCircleIcon className='size-4 text-blue-600' />,
	'input-available': <ClockIcon className='size-4 animate-pulse' />,
	'input-streaming': <CircleIcon className='size-4' />,
	'output-available': <CheckCircleIcon className='size-4 text-green-600' />,
	'output-denied': <XCircleIcon className='size-4 text-orange-600' />,
	'output-error': <XCircleIcon className='size-4 text-red-600' />,
};

/** Renders the current tool state as a compact badge. */
export const getStatusBadge = (status: ToolPart['state']) => (
	<Badge className='gap-1.5 rounded-full text-xs' variant='secondary'>
		{statusIcons[status]}
		{statusLabels[status]}
	</Badge>
);

/** Renders the clickable header for one tool call. */
export const ToolHeader = ({
	className,
	title,
	type,
	state,
	toolName,
	...props
}: ToolHeaderProps) => {
	const derivedName =
		type === 'dynamic-tool' ? toolName : type.split('-').slice(1).join('-');

	return (
		<CollapsibleTrigger
			className={cn(
				'flex w-full items-center justify-between gap-4 p-3',
				className,
			)}
			{...props}
		>
			<div className='flex items-center gap-2'>
				<WrenchIcon className='size-4 text-muted-foreground' />
				<span className='font-medium text-sm'>{title ?? derivedName}</span>
				{getStatusBadge(state)}
			</div>
			<ChevronDownIcon className='size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180' />
		</CollapsibleTrigger>
	);
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

/** Reveals tool input and output when the tool card is open. */
export const ToolContent = ({ className, ...props }: ToolContentProps) => (
	<CollapsibleContent
		className={cn(
			'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 space-y-4 p-4 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
			className,
		)}
		{...props}
	/>
);

export type ToolInputProps = ComponentProps<'div'> & {
	input: ToolPart['input'];
};

/** Renders the JSON parameters passed to a tool call. */
export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
	<div
		className={cn('flex flex-col gap-2 overflow-hidden', className)}
		{...props}
	>
		<h4 className='font-medium text-muted-foreground text-xs uppercase tracking-wide'>
			Parameters
		</h4>
		<ToolCodeBlock code={JSON.stringify(input, null, 2)} language='json' />
	</div>
);

type ToolCodeBlockProps = Pick<
	ComponentProps<typeof CodeBlock>,
	'code' | 'language'
> & {
	className?: string;
};

/** Provides shadcn scrollbars for tool payload panes. */
const ToolScrollArea = ({
	children,
	className,
	...props
}: ComponentProps<typeof ScrollAreaPrimitive.Root>) => (
	<ScrollAreaPrimitive.Root
		className={cn('relative max-h-80 overflow-hidden rounded-md', className)}
		data-slot='tool-scroll-area'
		{...props}
	>
		<ScrollAreaPrimitive.Viewport
			className='max-h-80 w-full rounded-[inherit] outline-none transition-[color,box-shadow] focus-visible:outline-1 focus-visible:ring-3 focus-visible:ring-ring/50'
			data-slot='tool-scroll-area-viewport'
		>
			{children}
		</ScrollAreaPrimitive.Viewport>
		<ScrollBar />
		<ScrollBar orientation='horizontal' />
		<ScrollAreaPrimitive.Corner />
	</ScrollAreaPrimitive.Root>
);

/** Renders highlighted tool code inside shadcn scroll-area chrome. */
const ToolCodeBlock = ({ className, ...props }: ToolCodeBlockProps) => (
	<ToolScrollArea className={cn('bg-muted/50 text-foreground', className)}>
		<CodeBlock
			className='min-w-max overflow-visible border-0 bg-transparent [&>div]:overflow-visible [&_pre]:p-3'
			{...props}
		/>
	</ToolScrollArea>
);

/** Converts a successful tool payload to a scrollable renderer. */
const renderToolOutput = (output: ToolPart['output']): ReactNode => {
	if (typeof output === 'object' && !isValidElement(output)) {
		return (
			<ToolCodeBlock code={JSON.stringify(output, null, 2)} language='json' />
		);
	}

	if (typeof output === 'string') {
		return <ToolCodeBlock code={output} language='json' />;
	}

	return (
		<ToolScrollArea className='bg-muted/50 text-foreground'>
			<div className='p-3 text-xs [&_table]:w-full'>{output as ReactNode}</div>
		</ToolScrollArea>
	);
};

export type ToolOutputProps = ComponentProps<'div'> & {
	output: ToolPart['output'];
	/**
	 * Error slot. Accepts a plain string or any `ReactNode` (e.g., a parsed
	 * stack-trace component) so callers can render rich error views without
	 * relabeling the heading.
	 */
	errorText: ReactNode;
};

/** Renders a tool result or error with shadcn scrollbars. */
export const ToolOutput = ({
	className,
	output,
	errorText,
	...props
}: ToolOutputProps) => {
	if (!(output || errorText)) {
		return null;
	}

	return (
		<div className={cn('flex flex-col gap-2', className)} {...props}>
			<h4 className='font-medium text-muted-foreground text-xs uppercase tracking-wide'>
				{errorText ? 'Error' : 'Result'}
			</h4>
			{errorText ? (
				<ToolScrollArea className='bg-destructive/10 text-destructive'>
					<div className='p-3 text-xs'>{errorText}</div>
				</ToolScrollArea>
			) : (
				renderToolOutput(output)
			)}
		</div>
	);
};
