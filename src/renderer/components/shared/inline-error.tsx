import { AlertCircleIcon, RefreshCwIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';

interface InlineErrorProps {
	title?: string;
	message: ReactNode;
	onRetry?: () => void;
	retrying?: boolean;
	className?: string;
}

/** Shared inline error block used by panels that show one-off operation failures. */
export function InlineError({
	className,
	message,
	onRetry,
	retrying,
	title = 'Something went wrong',
}: InlineErrorProps) {
	return (
		<div
			className={cn(
				'flex items-start gap-3 rounded-md border border-status-danger/30 bg-status-danger/5 px-3 py-2 text-xs',
				className,
			)}
		>
			<AlertCircleIcon
				aria-hidden='true'
				className='mt-0.5 size-4 shrink-0 text-status-danger'
			/>
			<div className='min-w-0 flex-1 space-y-1'>
				<div className='font-medium text-foreground'>{title}</div>
				<div className='text-muted-foreground leading-snug'>{message}</div>
			</div>
			{onRetry ? (
				<Button disabled={retrying} onClick={onRetry} size='sm' variant='ghost'>
					<RefreshCwIcon aria-hidden='true' className='size-3' />
					{retrying ? 'Retrying…' : 'Retry'}
				</Button>
			) : null}
		</div>
	);
}
