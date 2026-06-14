import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/renderer/lib/utils';

interface EmptyStateProps {
	title: string;
	description?: ReactNode;
	icon?: LucideIcon;
	action?: ReactNode;
	className?: string;
}

/** Shared empty-state block: dashed bordered card with title, hint, and optional CTA. */
export function EmptyState({
	action,
	className,
	description,
	icon: Icon,
	title,
}: EmptyStateProps) {
	return (
		<div
			className={cn(
				'flex flex-col items-center gap-3 rounded-md border border-dashed bg-muted/20 px-6 py-10 text-center',
				className,
			)}
		>
			{Icon ? (
				<Icon
					aria-hidden='true'
					className='size-6 text-muted-foreground'
					strokeWidth={1.5}
				/>
			) : null}
			<div className='space-y-1'>
				<h3 className='font-medium text-foreground text-sm'>{title}</h3>
				{description ? (
					<p className='text-muted-foreground text-xs leading-relaxed'>
						{description}
					</p>
				) : null}
			</div>
			{action ? <div className='pt-1'>{action}</div> : null}
		</div>
	);
}
