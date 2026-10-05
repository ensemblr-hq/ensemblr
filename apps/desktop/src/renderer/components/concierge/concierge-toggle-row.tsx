import type { TFunction } from 'i18next';
import { useAtomValue, useSetAtom } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';
import {
	conciergeActivityAtom,
	conciergeBadgeCount,
	conciergePresentationAtom,
	conciergeStreamingAtom,
	toggleConciergeAtom,
} from '@/renderer/state/concierge';
import { ConciergeMark } from './concierge-mark';
import { ConciergeUnreadBadge } from './concierge-unread-badge';

/**
 * The slim strip at the foot of a screen that opens and closes the Concierge.
 *
 * Every screen puts it in the same corner — under the terminal dock in the
 * workspace's review rail, and along the bottom edge of the content area
 * everywhere else — so the Concierge is always one glance to the bottom right.
 * The toggle keeps to its own width against the row's trailing edge in both,
 * which is what puts it in that corner whatever the row is as wide as.
 *
 * It also reports a shut Concierge: the mark orbits and a status word shows
 * while a turn is streaming, and a count sits at the trailing end for what it
 * produced unseen. Both come from `useConciergeActivityWatch`, which runs at the
 * app root, so the count survives a visit to a screen that drops this row.
 */
export function ConciergeToggleRow() {
	const { t } = useTranslation();
	const presentation = useAtomValue(conciergePresentationAtom);
	const toggle = useSetAtom(toggleConciergeAtom);
	const badgeCountAtom = useMemo(
		() => selectAtom(conciergeActivityAtom, conciergeBadgeCount),
		[],
	);
	const unreadCount = useAtomValue(badgeCountAtom);
	const isWorking = useAtomValue(conciergeStreamingAtom);
	const isOpen = presentation !== 'closed';

	return (
		<div
			className='flex h-8 shrink-0 items-center justify-end border-border border-t px-1.5'
			data-concierge-toggle-row=''
		>
			<Button
				aria-label={toggleLabel({ isOpen, isWorking, t, unreadCount })}
				className={cn(
					'gap-1.5 px-1.5 text-muted-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground',
					unreadCount > 0 && 'text-foreground',
				)}
				data-state={isOpen ? 'open' : 'closed'}
				onClick={toggle}
				size='xs'
				type='button'
				variant='ghost'
			>
				<ConciergeMark
					className={cn('size-4', isWorking && 'text-accent-strong')}
					orbitClassName={cn(
						'motion-safe:group-focus-visible/button:animate-concierge-orbit motion-safe:group-hover/button:animate-concierge-orbit',
						isWorking && 'motion-safe:animate-concierge-orbit',
					)}
				/>
				<span>{t('workbench:concierge.toggle.label', 'Concierge')}</span>
				{isWorking || unreadCount > 0 ? (
					<span className='flex items-center gap-1.5 pl-1'>
						{isWorking ? (
							<span className='font-normal text-muted-foreground text-xxs'>
								{t('workbench:concierge.toggle.working-status', 'Working')}
							</span>
						) : null}
						<ConciergeUnreadBadge count={unreadCount} />
					</span>
				) : null}
			</Button>
		</div>
	);
}

/**
 * Names what pressing the toggle does, in the one state that matters most.
 *
 * Whole sentences rather than a stem plus a suffix: a count appended to a
 * translated label reads as two fragments in Russian and Greek, and the i18n
 * lint rejects a sentence assembled across catalogue entries.
 * @param isOpen - Whether the Concierge panel is on screen right now.
 * @param isWorking - Whether a Concierge turn is streaming right now.
 * @param t - The translator to render with.
 * @param unreadCount - How many unseen things the badge is reporting.
 * @returns The toggle's accessible label.
 */
function toggleLabel({
	isOpen,
	isWorking,
	t,
	unreadCount,
}: {
	isOpen: boolean;
	isWorking: boolean;
	t: TFunction;
	unreadCount: number;
}): string {
	if (isOpen) {
		return t('workbench:concierge.toggle.close', 'Close the Concierge');
	}
	if (unreadCount > 0) {
		return t('workbench:concierge.toggle.open-with-unread', {
			count: unreadCount,
			defaultValue_one: 'Open the Concierge, {{count}} new message',
			defaultValue_other: 'Open the Concierge, {{count}} new messages',
		});
	}
	if (isWorking) {
		return t(
			'workbench:concierge.toggle.working',
			'Open the Concierge, still working',
		);
	}
	return t('workbench:concierge.toggle.open', 'Open the Concierge');
}
