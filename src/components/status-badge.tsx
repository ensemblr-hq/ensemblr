import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type StatusTone = 'danger' | 'info' | 'muted' | 'ok' | 'warning';

const toneClasses: Record<StatusTone, string> = {
	danger: 'border-status-danger/30 bg-status-danger/10 text-status-danger',
	info: 'border-accent/30 bg-accent/10 text-accent',
	muted: 'border-border bg-muted text-muted-foreground',
	ok: 'border-status-ok/25 bg-status-ok/10 text-status-ok',
	warning: 'border-status-warning/30 bg-status-warning/12 text-status-warning',
};

const dotClasses: Record<StatusTone, string> = {
	danger: 'bg-status-danger',
	info: 'bg-accent',
	muted: 'bg-muted-foreground',
	ok: 'bg-status-ok',
	warning: 'bg-status-warning',
};

interface StatusBadgeProps {
	children: ReactNode;
	className?: string;
	tone?: StatusTone;
}

export function StatusBadge({
	children,
	className,
	tone = 'muted',
}: StatusBadgeProps) {
	return (
		<Badge
			className={cn(
				'h-5 gap-1.5 rounded-md px-1.5 text-[0.6875rem]',
				toneClasses[tone],
				className,
			)}
			variant='outline'
		>
			<span
				aria-hidden='true'
				className={cn('size-1.5 rounded-full', dotClasses[tone])}
			/>
			{children}
		</Badge>
	);
}
