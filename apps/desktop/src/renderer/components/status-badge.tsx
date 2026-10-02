import type { ReactNode } from 'react';

import { Badge } from '@/renderer/components/ui/badge';
import { cn } from '@/renderer/lib/utils';

/** Semantic status tone shared by {@link StatusBadge} and {@link StatusDot}. */
type StatusTone = 'danger' | 'info' | 'muted' | 'ok' | 'warning';

const toneClasses: Record<StatusTone, string> = {
	danger: 'border-status-danger/30 bg-status-danger/10 text-status-danger',
	info: 'border-accent-strong/30 bg-accent-strong/10 text-accent-strong',
	muted: 'border-border bg-muted text-muted-foreground',
	ok: 'border-status-ok/25 bg-status-ok/10 text-status-ok',
	warning: 'border-status-warning/30 bg-status-warning/12 text-status-warning',
};

const dotClasses: Record<StatusTone, string> = {
	danger: 'bg-status-danger',
	info: 'bg-accent-strong',
	muted: 'bg-muted-foreground',
	ok: 'bg-status-ok',
	warning: 'bg-status-warning',
};

/** Bare colored status dot. Shared by {@link StatusBadge} and status strips. */
export function StatusDot({
	className,
	tone = 'muted',
}: {
	className?: string;
	tone?: StatusTone;
}) {
	return (
		<span
			aria-hidden='true'
			className={cn('size-1.5 rounded-full', dotClasses[tone], className)}
		/>
	);
}

/** Compact pill-shaped status indicator with a colored leading dot. */
export function StatusBadge({
	children,
	className,
	tone = 'muted',
}: {
	children: ReactNode;
	className?: string;
	tone?: StatusTone;
}) {
	return (
		<Badge
			className={cn(
				'h-5 gap-1.5 rounded-md px-1.5 text-xxs',
				toneClasses[tone],
				className,
			)}
			variant='outline'
		>
			<StatusDot tone={tone} />
			{children}
		</Badge>
	);
}
