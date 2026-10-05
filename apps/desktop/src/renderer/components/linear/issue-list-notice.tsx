import {
	CircleAlertIcon,
	RefreshCwIcon,
	TriangleAlertIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { useRefreshSpin } from '@/renderer/hooks/linear/use-refresh-spin';
import { cn } from '@/renderer/lib/utils';

/**
 * Says why the Linear issue list may be short or out of date. The tone is
 * carried by the icon and the frame, while the sentence stays in the regular
 * foreground so a long list of organizations remains readable. A retry is
 * offered only when the cause can clear up on its own; a reconnect cannot be
 * fixed by asking Linear again.
 */
export function LinearIssueListNotice({
	message,
	onRetry,
	refreshing,
	tone,
}: {
	message: string;
	onRetry: (() => void) | null;
	refreshing: boolean;
	tone: 'danger' | 'warning';
}) {
	const { t } = useTranslation();
	const spin = useRefreshSpin(refreshing);
	const Icon = tone === 'danger' ? CircleAlertIcon : TriangleAlertIcon;

	return (
		<div
			className={cn(
				'flex items-start gap-2.5 rounded-lg border px-3 py-2',
				tone === 'danger'
					? 'border-status-danger/30 bg-status-danger/5'
					: 'border-status-warning/30 bg-status-warning/5',
			)}
			role='status'
		>
			<Icon
				aria-hidden='true'
				className={cn(
					'mt-0.5 size-3.5 shrink-0',
					tone === 'danger' ? 'text-status-danger' : 'text-status-warning',
				)}
			/>
			<p className='min-w-0 flex-1 text-pretty text-foreground text-xs leading-relaxed'>
				{message}
			</p>
			{onRetry ? (
				<Button
					className='-my-0.5 shrink-0'
					disabled={spin.active}
					onClick={() => {
						spin.start();
						onRetry();
					}}
					size='xs'
					variant='ghost'
				>
					<RefreshCwIcon
						className={spin.active ? 'animate-spin' : undefined}
						data-icon='inline-start'
					/>
					{t('common:actions.try-again', 'Try again')}
				</Button>
			) : null}
		</div>
	);
}
