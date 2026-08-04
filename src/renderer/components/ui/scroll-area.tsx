import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/renderer/lib/utils';

function ScrollArea({
	className,
	children,
	...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
	return (
		<ScrollAreaPrimitive.Root
			data-slot='scroll-area'
			className={cn('relative', className)}
			{...props}
		>
			<ScrollAreaPrimitive.Viewport
				data-slot='scroll-area-viewport'
				className='[&>div]:!block size-full rounded-[inherit] outline-none transition-[color,box-shadow] focus-visible:outline-1 focus-visible:ring-3 focus-visible:ring-ring/50'
			>
				{children}
			</ScrollAreaPrimitive.Viewport>
			<ScrollBar />
			<ScrollAreaPrimitive.Corner />
		</ScrollAreaPrimitive.Root>
	);
}

function ScrollBar({
	className,
	orientation = 'vertical',
	...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
	return (
		<ScrollAreaPrimitive.ScrollAreaScrollbar
			data-slot='scroll-area-scrollbar'
			data-orientation={orientation}
			orientation={orientation}
			className={cn(
				'group/scrollbar flex touch-none select-none transition-colors data-horizontal:h-scrollbar data-vertical:h-full data-vertical:w-scrollbar data-horizontal:flex-col',
				className,
			)}
			{...props}
		>
			<ScrollAreaPrimitive.ScrollAreaThumb
				data-slot='scroll-area-thumb'
				className='relative flex-1 rounded-full bg-border transition-colors group-hover/scrollbar:bg-muted-foreground'
			/>
		</ScrollAreaPrimitive.ScrollAreaScrollbar>
	);
}

export { ScrollArea, ScrollBar };
