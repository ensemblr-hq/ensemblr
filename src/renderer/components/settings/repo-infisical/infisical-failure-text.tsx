import { AlertTriangleIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { failureDetail, failureText } from '@/renderer/lib/failure-text';
import { cn } from '@/renderer/lib/utils';
import type { InfisicalFailure } from '@/shared/ipc/contracts/infisical';

/**
 * Renders a failure as its translated headline plus, when main's own message
 * carries runtime specifics the headline cannot, that message beneath it. An
 * unmapped code would otherwise render as a generic sentence with the real
 * cause discarded.
 */
export function InfisicalFailureText({
	className,
	failure,
}: {
	failure: InfisicalFailure;
	className?: string;
}) {
	const { t } = useTranslation();
	const detail = failureDetail(t, failure);

	return (
		<div
			className={cn(
				'flex items-start gap-2 rounded-lg border border-status-danger/30 bg-status-danger/10 px-3 py-2',
				className,
			)}
		>
			<AlertTriangleIcon
				aria-hidden='true'
				className='mt-0.5 size-3.5 shrink-0 text-status-danger'
			/>
			<div className='min-w-0 space-y-0.5'>
				<p className='text-status-danger text-xs'>{failureText(t, failure)}</p>
				{detail ? (
					<p className='break-words text-muted-foreground text-xs'>{detail}</p>
				) : null}
			</div>
		</div>
	);
}
