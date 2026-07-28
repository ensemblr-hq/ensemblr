import { CheckIcon, PencilIcon, SplitIcon } from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';

/**
 * Decision bar for a finished agent plan. Sits directly above the composer
 * card, inside the composer's footer, so it shares the footer's width.
 *
 * Deliberately spare: the plan itself is the message immediately above, and the
 * agent has already stopped. All this surface has to do is name the plan and
 * offer the three ways forward — anything more competes with the plan for
 * attention and squeezes the composer.
 */
export function PlanReviewPanel({
	busy,
	onApprove,
	onHandoff,
	onRefine,
	title,
}: {
	/** Disables every action while the handoff tab is being created. */
	busy?: boolean;
	onApprove: () => void;
	onHandoff: () => void;
	onRefine: () => void;
	title: string;
}) {
	return (
		<section
			aria-label='Plan review'
			className='mx-auto mb-2 flex w-full max-w-4xl flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-accent-strong/25 bg-accent-strong/5 px-3 py-2'
		>
			<h2 className='min-w-0 flex-1 truncate font-medium text-sm'>{title}</h2>
			<div className='flex shrink-0 items-center gap-1'>
				<Button disabled={busy} onClick={onApprove} size='sm' type='button'>
					<CheckIcon />
					Approve
				</Button>
				<Button
					disabled={busy}
					onClick={onRefine}
					size='sm'
					type='button'
					variant='subtle'
				>
					<PencilIcon />
					Refine
				</Button>
				<Button
					disabled={busy}
					onClick={onHandoff}
					size='sm'
					type='button'
					variant='subtle'
				>
					<SplitIcon />
					Hand off
				</Button>
			</div>
		</section>
	);
}
