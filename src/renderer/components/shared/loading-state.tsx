import { Spinner } from '@/renderer/components/ui/spinner';
import { cn } from '@/renderer/lib/utils';

interface LoadingStateProps {
	message?: string;
	compact?: boolean;
	className?: string;
}

/** Shared loading row used while a panel is awaiting its first IPC response. */
export function LoadingState({
	className,
	compact,
	message = 'Loading…',
}: LoadingStateProps) {
	return (
		<div
			className={cn(
				'flex items-center gap-2 text-muted-foreground text-sm',
				compact ? 'py-1' : 'py-6',
				className,
			)}
		>
			<Spinner className={compact ? 'size-3' : 'size-4'} />
			<span>{message}</span>
		</div>
	);
}
