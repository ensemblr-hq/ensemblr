import type { ReactNode } from 'react';

import { cn } from '@/renderer/lib/utils';

/** Dashed-border empty state shared across settings lists. */
export function SettingsEmptyState({
	className,
	description,
	title,
}: {
	title: ReactNode;
	description?: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				'rounded-md border border-dashed py-8 text-center text-muted-foreground text-sm',
				className,
			)}
		>
			<div className='font-medium text-foreground'>{title}</div>
			{description ? <p className='mt-1'>{description}</p> : null}
		</div>
	);
}
