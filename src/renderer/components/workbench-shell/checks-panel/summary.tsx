import {
	CheckIcon,
	CircleDashedIcon,
	CircleIcon,
	LoaderCircleIcon,
} from 'lucide-react';

import { cn } from '@/renderer/lib/utils';
import type { ChecksPanelState } from '@/renderer/types/components';
import type { PullRequestCheckStatus } from '@/renderer/types/workbench';

type ChecksSummaryStatus = PullRequestCheckStatus | 'open';

const SUMMARY_CONTAINER_CLASSES: Record<ChecksSummaryStatus, string> = {
	blocked: 'border-status-danger/30 bg-status-danger/10 text-status-danger',
	open: 'border-border bg-muted/30',
	pending: 'border-status-warning/30 bg-status-warning/10',
	ready: 'border-status-ok/30 bg-status-ok/10 text-status-ok',
};

const SUMMARY_DETAIL_CLASSES: Record<ChecksSummaryStatus, string> = {
	blocked: 'text-status-danger',
	open: 'text-muted-foreground',
	pending: 'text-muted-foreground',
	ready: 'text-status-ok',
};

/** Top summary block describing PR readiness in plain language. */
export function ChecksPanelSummary({ state }: { state: ChecksPanelState }) {
	return (
		<section
			className={cn(
				'flex min-w-0 items-start gap-2 rounded-md border p-2.5',
				SUMMARY_CONTAINER_CLASSES[state.status],
			)}
			data-checks-panel-state={state.kind}
		>
			<ChecksPanelSummaryIcon status={state.status} />
			<div className='min-w-0 flex-1'>
				<h2 className='min-w-0 truncate font-semibold text-sm'>
					{state.title}
				</h2>
				<p
					className={cn(
						'wrap-break-word min-w-0 text-xs leading-4',
						SUMMARY_DETAIL_CLASSES[state.status],
					)}
				>
					{state.detail}
				</p>
			</div>
		</section>
	);
}

/** Status icon rendered next to the checks summary headline. */
function ChecksPanelSummaryIcon({
	status,
}: {
	status: PullRequestCheckStatus | 'open';
}) {
	if (status === 'ready') {
		return (
			<CheckIcon
				aria-hidden='true'
				className='mt-0.5 size-3.5 shrink-0 text-status-ok'
			/>
		);
	}

	if (status === 'pending') {
		return (
			<LoaderCircleIcon
				aria-hidden='true'
				className='mt-0.5 size-3.5 shrink-0 animate-spin text-status-warning'
			/>
		);
	}

	if (status === 'blocked') {
		return (
			<CircleDashedIcon
				aria-hidden='true'
				className='mt-0.5 size-3.5 shrink-0 text-status-danger'
			/>
		);
	}

	return (
		<CircleIcon
			aria-hidden='true'
			className='mt-0.5 size-3.5 shrink-0 text-muted-foreground'
		/>
	);
}
