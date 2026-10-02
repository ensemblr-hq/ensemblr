import { CheckIcon, PencilIcon, SplitIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';

/**
 * Resting wash for the two secondary decisions. `subtle` alone is invisible until
 * hovered, which left Approve as the only thing in the bar that looked clickable.
 */
const QUIET_ACTION_CLASSES = 'bg-foreground/5 hover:bg-foreground/10';

/**
 * Decision bar for a finished agent plan. Renders as the composer card's
 * header — same rounded card, same dashed border, divided from the textarea
 * below by a hairline rather than a gap — so it reads as the top of the
 * composer, not a separate floating panel above it.
 *
 * Deliberately spare: the plan itself is the message immediately above, and the
 * agent has already stopped. The bar carries nothing but the three ways
 * forward — a title here would only restate the plan's own heading and squeeze
 * the composer. Sized as a toolbar strip rather than a panel, and its trailing
 * padding is short by the button's own, so the last label lands in the same ink
 * column as the send button and the message text below it.
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
	const { t } = useTranslation();
	return (
		<section
			aria-label={t('workbench:plan-review.aria-label', 'Plan review')}
			className='flex items-center justify-end gap-1 border-accent-strong/25 border-b border-dashed bg-accent-strong/[0.06] py-1.5 pr-2 pl-4'
		>
			<Button disabled={busy} onClick={onApprove} size='xs' type='button'>
				<CheckIcon />
				{t('common:actions.approve', 'Approve')}
			</Button>
			<Button
				className={QUIET_ACTION_CLASSES}
				disabled={busy}
				onClick={onRefine}
				size='xs'
				type='button'
				variant='subtle'
			>
				<PencilIcon />
				{t('workbench:plan-review.actions.refine', 'Refine')}
			</Button>
			<Button
				className={QUIET_ACTION_CLASSES}
				disabled={busy}
				onClick={onHandoff}
				size='xs'
				type='button'
				variant='subtle'
			>
				<SplitIcon />
				{t('workbench:plan-review.actions.hand-off', 'Hand off')}
			</Button>
		</section>
	);
}
