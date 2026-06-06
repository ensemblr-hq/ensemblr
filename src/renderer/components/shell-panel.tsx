import type { ReactNode } from 'react';

import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from '@/renderer/components/ui/card';
import { cn } from '@/renderer/lib/utils';

interface ShellPanelProps {
	action?: ReactNode;
	children: ReactNode;
	className?: string;
	description?: string;
	eyebrow?: string;
	footer?: ReactNode;
	size?: 'default' | 'sm';
	title: string;
}

export function ShellPanel({
	action,
	children,
	className,
	description,
	eyebrow,
	footer,
	size = 'default',
	title,
}: ShellPanelProps) {
	return (
		<Card
			className={cn('border-border bg-card shadow-panel', className)}
			size={size}
		>
			<CardHeader className='gap-1.5 border-border border-b px-3 py-2.5'>
				<div className='flex min-w-0 flex-col gap-0.5'>
					{eyebrow ? (
						<p className='font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-wide'>
							{eyebrow}
						</p>
					) : null}
					<CardTitle className='text-[0.8125rem]'>{title}</CardTitle>
					{description ? (
						<CardDescription className='max-w-2xl text-xs leading-5'>
							{description}
						</CardDescription>
					) : null}
				</div>
				{action ? <CardAction>{action}</CardAction> : null}
			</CardHeader>
			<CardContent className='px-3'>{children}</CardContent>
			{footer ? <CardFooter>{footer}</CardFooter> : null}
		</Card>
	);
}
