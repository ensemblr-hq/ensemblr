import type { ReactNode } from 'react';

import { useTabScroller } from '@/renderer/hooks/use-tab-scroller';
import { cn } from '@/renderer/lib/utils';

/**
 * Horizontal scroll surface for a tab strip. Scrolls the active tab fully into
 * view whenever it changes and overlays a thin scrollbar that fades in while the
 * strip is scrolled or hovered, so the tabs never lose height to a gutter. Each
 * tab inside must publish its id as `data-tab-key`.
 */
export function TabScroller({
	activeKey,
	children,
	className,
}: {
	activeKey: string | null;
	children: ReactNode;
	className?: string;
}) {
	const { thumbRef, viewportRef, wrapperRef } = useTabScroller(activeKey);

	return (
		<div
			className={cn('relative min-w-0', className)}
			data-slot='tab-scroller'
			ref={wrapperRef}
		>
			<div
				className='no-scrollbar h-full overflow-x-auto overflow-y-hidden'
				data-slot='tab-scroller-viewport'
				ref={viewportRef}
			>
				{children}
			</div>
			<div
				aria-hidden='true'
				className='pointer-events-none absolute bottom-1 left-0 h-1 w-0 touch-none rounded-full bg-muted-foreground/40 opacity-0 transition-opacity duration-200 ease-out hover:bg-muted-foreground/70 data-[visible=true]:pointer-events-auto data-[visible=true]:opacity-100'
				data-slot='tab-scroller-thumb'
				ref={thumbRef}
			/>
		</div>
	);
}
