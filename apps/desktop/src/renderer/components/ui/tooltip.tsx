'use client';

import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/renderer/lib/utils';

function TooltipProvider({
	delayDuration = 0,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
	return (
		<TooltipPrimitive.Provider
			data-slot='tooltip-provider'
			delayDuration={delayDuration}
			{...props}
		/>
	);
}

function Tooltip({
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
	return <TooltipPrimitive.Root data-slot='tooltip' {...props} />;
}

function TooltipTrigger({
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
	return <TooltipPrimitive.Trigger data-slot='tooltip-trigger' {...props} />;
}

function TooltipContent({
	arrow = false,
	className,
	sideOffset = 0,
	children,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
	arrow?: boolean;
}) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Content
				data-slot='tooltip-content'
				sideOffset={sideOffset}
				className={cn(
					'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 z-50 inline-flex w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-md bg-popover px-2.5 py-1.5 text-popover-foreground text-xs shadow-md ring-1 ring-foreground/10 has-data-[slot=kbd]:pr-1.5 data-[state=delayed-open]:animate-in data-closed:animate-out data-open:animate-in **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm',
					className,
				)}
				{...props}
			>
				{children}
				{arrow ? (
					<TooltipPrimitive.Arrow className='z-50 size-2.5 translate-y-[calc(-50%_-_0.125rem)] rotate-45 rounded-sm bg-popover fill-popover ring-1 ring-foreground/10' />
				) : null}
			</TooltipPrimitive.Content>
		</TooltipPrimitive.Portal>
	);
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
