import type * as React from 'react';

import { cn } from './class-names';

/** Renders a theme-aware placeholder while content is loading. */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
	return (
		<div
			data-slot='skeleton'
			className={cn('animate-pulse rounded-md bg-muted', className)}
			{...props}
		/>
	);
}

export { Skeleton };
