import {
	AlertCircleIcon,
	CheckCircle2Icon,
	CircleDashedIcon,
	RefreshCwIcon,
	ShieldAlertIcon,
} from 'lucide-react';

import { StatusBadge } from '@/renderer/components/status-badge';
import { Button } from '@/renderer/components/ui/button';
import { isRemediationActionButton } from '@/renderer/lib/setup-diagnostics';
import { cn } from '@/renderer/lib/utils';
import type { SetupCheckSnapshot, SetupCheckStatus, SetupRemediationAction } from '@/shared/ipc/contracts/setup';

const CHECK_STATUS_LABELS: Record<SetupCheckStatus, string> = {
	failure: 'Failed',
	pending: 'Pending',
	running: 'Running',
	success: 'Ready',
	warning: 'Warning',
};

const CHECK_STATUS_TONE: Record<
	SetupCheckStatus,
	'danger' | 'info' | 'muted' | 'ok' | 'warning'
> = {
	failure: 'danger',
	pending: 'muted',
	running: 'info',
	success: 'ok',
	warning: 'warning',
};

const CHECK_STATUS_ICON = {
	failure: AlertCircleIcon,
	pending: CircleDashedIcon,
	running: RefreshCwIcon,
	success: CheckCircle2Icon,
	warning: ShieldAlertIcon,
} satisfies Record<SetupCheckStatus, typeof AlertCircleIcon>;

/** Single setup-check row showing status, detail, logs, and remediation actions. */
export function SetupCheckRow({
	check,
	onRemediationAction,
	onRetry,
}: {
	check: SetupCheckSnapshot;
	onRemediationAction?: (
		action: SetupRemediationAction,
		check: SetupCheckSnapshot,
	) => void | Promise<void>;
	onRetry?: () => void;
}) {
	const Icon = CHECK_STATUS_ICON[check.status];
	const handleRemediationAction = async (action: SetupRemediationAction) => {
		if (onRemediationAction) {
			await onRemediationAction(action, check);
			return;
		}

		// Standalone fallback: when this row is mounted without a parent
		// `onRemediationAction` (e.g. the compact panel), drive the Pi
		// executable picker directly. Kept intentionally as a self-contained
		// escape hatch so the compact view can ship without a parent
		// controller. TODO: require onRemediationAction once compact panel
		// gets its own remediation controller.
		if (
			action.kind === 'select-path' &&
			action.target === 'pi.executablePath' &&
			check.id === 'pi-executable'
		) {
			await window.ensemble?.selectPiExecutable();
			onRetry?.();
		}
	};

	return (
		<div className='flex flex-col gap-2 px-3 py-2.5'>
			<div className='flex items-start justify-between gap-3'>
				<div className='flex min-w-0 items-start gap-2'>
					<Icon
						aria-hidden='true'
						className={cn(
							'mt-0.5 size-4 shrink-0',
							check.status === 'failure' && 'text-status-danger',
							check.status === 'success' && 'text-status-ok',
							check.status === 'warning' && 'text-status-warning',
							check.status === 'pending' && 'text-muted-foreground',
							check.status === 'running' && 'text-accent-strong',
						)}
					/>
					<div className='min-w-0'>
						<div className='flex flex-wrap items-center gap-1.5'>
							<h3 className='font-medium text-xs'>{check.title}</h3>
							{check.blocking ? (
								<StatusBadge tone='muted'>Required</StatusBadge>
							) : (
								<StatusBadge tone='info'>Optional</StatusBadge>
							)}
						</div>
						<p className='mt-1 text-muted-foreground text-xs leading-5'>
							{check.detail}
						</p>
						<p className='mt-1 text-muted-foreground text-xxs leading-4'>
							{check.description}
						</p>
					</div>
				</div>
				<StatusBadge tone={CHECK_STATUS_TONE[check.status]}>
					{CHECK_STATUS_LABELS[check.status]}
				</StatusBadge>
			</div>

			{check.remediationActions.length ? (
				<div className='flex flex-wrap gap-1.5 pl-6'>
					{check.remediationActions.map((action) =>
						isRemediationActionButton(action, check) ? (
							<Button
								className='h-6 px-2 text-xxs leading-none'
								data-remediation-action={action.id}
								key={action.id}
								onClick={() => {
									void handleRemediationAction(action);
								}}
								size='xs'
								type='button'
								variant='outline'
							>
								{action.label}
							</Button>
						) : (
							<span
								className='rounded-sm border border-border bg-muted px-1.5 py-1 text-muted-foreground text-xxs leading-none'
								key={action.id}
							>
								{action.label}
							</span>
						),
					)}
				</div>
			) : null}

			{check.logs.length ? (
				<details className='ml-6 rounded-md border border-border bg-background/60 px-2 py-1.5 text-xs'>
					<summary className='cursor-default text-muted-foreground'>
						Diagnostics log
					</summary>
					<div className='mt-1.5 flex flex-col gap-1'>
						{check.logs.slice(0, 4).map((log) => (
							<p
								className='break-words text-muted-foreground leading-5'
								key={`${log.label}-${log.text}`}
							>
								<span className='font-medium text-foreground'>{log.label}</span>
								{': '}
								{log.text}
								{log.truncated ? ' (truncated)' : null}
							</p>
						))}
					</div>
				</details>
			) : null}
		</div>
	);
}
