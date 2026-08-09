import { Spinner } from '@/renderer/components/ui/spinner';
import { cn } from '@/renderer/lib/utils';

/** In-flight placeholder for a settings list that is still loading its data. */
export function SettingsLoadingState({
	className,
	label,
}: {
	label: string;
	className?: string;
}) {
	return (
		<div
			className={cn(
				'flex items-center gap-2 py-6 text-muted-foreground text-sm',
				className,
			)}
		>
			<Spinner className='size-4' />
			{label}
		</div>
	);
}

/** Failure message for a settings list whose data could not be read. */
export function SettingsErrorState({
	className,
	message,
}: {
	message: string;
	className?: string;
}) {
	return (
		<p className={cn('py-6 text-sm text-status-danger', className)}>
			{message}
		</p>
	);
}
