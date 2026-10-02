import type { LucideIcon } from 'lucide-react';

import { cn } from '@/renderer/lib/utils';

/**
 * Centered icon, headline, and supporting copy filling a review-panel tab that
 * has nothing to list. The danger tone reuses the same layout for failures so an
 * error reads as a deliberate state rather than a stray banner, and `detail`
 * carries the raw underlying message without letting it become the headline.
 */
export function PanelPlaceholder({
	detail,
	icon: PlaceholderIcon,
	message,
	title,
	tone = 'muted',
}: {
	/** Verbatim underlying error text, demoted below the human-readable copy. */
	detail?: string;
	icon: LucideIcon;
	message: string;
	title: string;
	tone?: 'danger' | 'muted';
}) {
	const isDanger = tone === 'danger';

	return (
		<div
			className='h-full overflow-y-auto'
			role={isDanger ? 'alert' : undefined}
		>
			<div className='flex min-h-full flex-col items-center justify-center gap-4 px-8 py-10 text-center'>
				<span
					className={cn(
						'flex size-12 shrink-0 items-center justify-center rounded-full',
						isDanger ? 'bg-status-danger/10' : 'bg-muted',
					)}
				>
					<PlaceholderIcon
						aria-hidden='true'
						className={cn(
							'size-6',
							isDanger ? 'text-status-danger' : 'text-muted-foreground',
						)}
						strokeWidth={1.5}
					/>
				</span>
				<div className='flex max-w-xs flex-col gap-1'>
					<p className='font-medium text-foreground text-sm'>{title}</p>
					<p className='text-muted-foreground text-xs leading-5'>{message}</p>
				</div>
				{detail ? (
					<p className='max-w-sm break-words rounded-md border border-border bg-pane px-3 py-2 text-left font-mono text-muted-foreground text-xs leading-5'>
						{detail}
					</p>
				) : null}
			</div>
		</div>
	);
}
