import { CheckIcon, CircleDashedIcon, LoaderCircleIcon } from 'lucide-react';

import type { PullRequestCheckStatus } from '@/renderer/types/workbench';

/** Lucide icon mapped to the check status (success/warning/blocked/etc). */
export function PullRequestCheckStatusIcon({
	status,
}: {
	status: PullRequestCheckStatus;
}) {
	if (status === 'ready') {
		return (
			<CheckIcon
				aria-hidden='true'
				className='size-3 shrink-0 text-status-ok'
			/>
		);
	}

	if (status === 'pending') {
		return (
			<LoaderCircleIcon
				aria-hidden='true'
				className='size-3 shrink-0 animate-spin text-status-warning'
			/>
		);
	}

	return (
		<CircleDashedIcon
			aria-hidden='true'
			className='size-3 shrink-0 text-status-danger'
		/>
	);
}
