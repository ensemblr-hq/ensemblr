import type { ReactNode } from 'react';

import { cn } from '@/renderer/lib/utils';

/** Dashed-border empty state shared across settings lists, with an optional call to action. */
export function SettingsEmptyState({
	children,
	className,
	description,
	title,
}: {
	title: ReactNode;
	description?: ReactNode;
	children?: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				'flex flex-col items-center gap-1 rounded-xl border border-border border-dashed px-4 py-7 text-center',
				className,
			)}
		>
			<p className='font-medium text-foreground text-sm'>{title}</p>
			{description ? (
				<p className='max-w-prose text-pretty text-muted-foreground text-xs'>
					{description}
				</p>
			) : null}
			{children ? <div className='pt-2'>{children}</div> : null}
		</div>
	);
}
