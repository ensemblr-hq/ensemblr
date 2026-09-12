import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
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

/**
 * The retry control on a failed settings read. Split out of
 * {@link SettingsErrorState} so an error with no retry never subscribes to the
 * i18n instance, the same reason `Button` keeps its pending label separate.
 */
function SettingsErrorRetry({ onRetry }: { onRetry: () => void }) {
	const { t } = useTranslation();

	return (
		<Button onClick={onRetry} size='xs' variant='outline'>
			{t('common:actions.try-again', 'Try again')}
		</Button>
	);
}

/**
 * Failure message for a settings list whose data could not be read, with the
 * retry the caller offers when the read is one worth attempting again.
 */
export function SettingsErrorState({
	className,
	message,
	onRetry,
}: {
	message: string;
	className?: string;
	/** Re-runs the failed read; omitted when retrying cannot help. */
	onRetry?: () => void;
}) {
	if (!onRetry) {
		return (
			<p className={cn('py-6 text-sm text-status-danger', className)}>
				{message}
			</p>
		);
	}

	return (
		<div className={cn('flex flex-col items-start gap-2 py-6', className)}>
			<p className='text-sm text-status-danger'>{message}</p>
			<SettingsErrorRetry onRetry={onRetry} />
		</div>
	);
}
