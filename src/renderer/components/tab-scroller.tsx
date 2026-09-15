import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useTabScroller } from '@/renderer/hooks/use-tab-scroller';
import { cn } from '@/renderer/lib/utils';

/**
 * Horizontal scroll surface for a tab strip. Scrolls the active tab fully into
 * view whenever it changes, fades whichever end still has tabs beyond it and
 * offers an arrow that pages the strip that way, and overlays a thin scrollbar
 * that fades in while the strip is scrolled or hovered, so the tabs never lose
 * height to a gutter. Each tab inside must publish its id as `data-tab-key`.
 */
export function TabScroller({
	activeKey,
	children,
	className,
}: {
	activeKey: string | null;
	children: ReactNode;
	className?: string;
}) {
	const { t } = useTranslation();
	const { scrollByPage, thumbRef, viewportRef, wrapperRef } =
		useTabScroller(activeKey);

	return (
		<div
			className={cn('group/tab-scroller relative min-w-0', className)}
			data-slot='tab-scroller'
			ref={wrapperRef}
		>
			<div
				className='no-scrollbar tab-scroller-fade h-full overflow-x-auto overflow-y-hidden'
				data-slot='tab-scroller-viewport'
				ref={viewportRef}
			>
				{children}
			</div>
			<TabScrollerArrow
				direction='start'
				label={t('common:tab-scroller.scroll-left', 'Scroll tabs left')}
				onActivate={() => scrollByPage(-1)}
			/>
			<TabScrollerArrow
				direction='end'
				label={t('common:tab-scroller.scroll-right', 'Scroll tabs right')}
				onActivate={() => scrollByPage(1)}
			/>
			<div
				aria-hidden='true'
				className='pointer-events-none absolute bottom-1 left-0 h-1 w-0 touch-none rounded-full bg-muted-foreground/40 opacity-0 transition-opacity duration-200 ease-out hover:bg-muted-foreground/70 data-[visible=true]:pointer-events-auto data-[visible=true]:opacity-100'
				data-slot='tab-scroller-thumb'
				ref={thumbRef}
			/>
		</div>
	);
}

/**
 * One end-of-strip paging arrow, shown only while the strip can still travel
 * that way. It overlays the faded tabs rather than sitting beside them, so
 * appearing costs the strip no width and cannot reflow the tabs it describes.
 * Kept out of the tab order: it duplicates a gesture keyboard users already get
 * for free, since activating a clipped tab scrolls it into view by itself.
 *
 * Resting state is `invisible` rather than transparent, because opacity alone
 * leaves the button in the accessibility tree — a strip that cannot scroll would
 * still announce two arrows that do nothing. `visibility` also inherits, so the
 * icon goes with it, and it suppresses hit-testing without a second utility.
 * `preventDefault` on pointerdown keeps the click from pulling focus out of
 * whatever the user was typing in, which `tabIndex` alone does not stop.
 */
function TabScrollerArrow({
	direction,
	label,
	onActivate,
}: {
	direction: 'end' | 'start';
	label: string;
	onActivate: () => void;
}) {
	const isStart = direction === 'start';
	const ArrowIcon = isStart ? ChevronLeftIcon : ChevronRightIcon;

	return (
		<button
			aria-label={label}
			className={cn(
				'invisible absolute inset-y-0 grid w-8 place-items-center text-muted-foreground opacity-0 transition-[opacity,visibility] duration-200 ease-out hover:text-foreground',
				isStart
					? 'left-0 group-data-[overflow-start=true]/tab-scroller:visible group-data-[overflow-start=true]/tab-scroller:opacity-100'
					: 'right-0 group-data-[overflow-end=true]/tab-scroller:visible group-data-[overflow-end=true]/tab-scroller:opacity-100',
			)}
			data-slot={`tab-scroller-arrow-${direction}`}
			onClick={onActivate}
			onPointerDown={(event) => event.preventDefault()}
			tabIndex={-1}
			type='button'
		>
			<ArrowIcon aria-hidden='true' className='size-3.5' />
		</button>
	);
}
