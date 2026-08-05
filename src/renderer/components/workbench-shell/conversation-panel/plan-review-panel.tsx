import { CheckIcon, PencilIcon, SplitIcon } from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';

/**
 * Decision bar for a finished agent plan. Renders as the composer card's
 * header — same rounded card, same dashed border, divided from the textarea
 * below by a hairline rather than a gap — so it reads as the top of the
 * composer, not a separate floating panel above it.
 *
 * Deliberately spare: the plan itself is the message immediately above, and the
 * agent has already stopped. The bar carries nothing but the three ways
 * forward — a title here would only restate the plan's own heading and squeeze
 * the composer.
 */
export function PlanReviewPanel({
	busy,
	onApprove,
	onHandoff,
	onRefine,
}: {
	/** Disables every action while the handoff tab is being created. */
	busy?: boolean;
	onApprove: () => void;
	onHandoff: () => void;
	onRefine: () => void;
}) {
	return (
		<section
			aria-label='Plan review'
			className='flex items-center justify-end gap-1 border-accent-strong/25 border-b border-dashed bg-accent-strong/[0.06] px-4 py-2.5'
		>
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
		</section>
	);
}
