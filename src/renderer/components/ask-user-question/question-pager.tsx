/**
 * Question pager for a multi-question agent dialog: previous/next chevrons and
 * one dot per question, filled once that question has an answer.
 */
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';

/**
 * Picks the dot fill for one question: solid for the one on screen, dimmer once
 * answered, faintest while still untouched.
 * @param active - Whether this question is the one on screen.
 * @param answered - Whether this question already has an answer.
 * @returns The background utility for the dot.
 */
function dotFill(active: boolean, answered: boolean): string {
	if (active) {
		return 'bg-foreground';
	}
	return answered ? 'bg-muted-foreground/70' : 'bg-muted-foreground/35';
}

/**
 * Renders the pager. Returns nothing for a single-question dialog, where there
 * is nothing to page between.
 */
export function QuestionPager({
	activeIndex,
	onGoToPage,
	onMovePage,
	pages,
}: {
	activeIndex: number;
	onGoToPage: (index: number) => void;
	onMovePage: (delta: number) => void;
	pages: readonly { answered: boolean; key: string; label: string }[];
}) {
	if (pages.length < 2) {
		return null;
	}
	return (
		<div className='flex items-center gap-0.5'>
			<Button
				aria-label='Previous question'
				onClick={() => onMovePage(-1)}
				size='icon-xs'
				type='button'
				variant='subtle'
			>
				<ChevronLeftIcon aria-hidden='true' />
			</Button>
			<div className='flex items-center'>
				{pages.map((page, index) => (
					<button
						aria-current={index === activeIndex}
						aria-label={page.label}
						className='group/dot flex h-5 w-3.5 items-center justify-center'
						key={page.key}
						onClick={() => onGoToPage(index)}
						type='button'
					>
						<span
							className={cn(
								'size-1.5 rounded-full transition-colors group-hover/dot:bg-foreground',
								dotFill(index === activeIndex, page.answered),
							)}
						/>
					</button>
				))}
			</div>
			<Button
				aria-label='Next question'
				onClick={() => onMovePage(1)}
				size='icon-xs'
				type='button'
				variant='subtle'
			>
				<ChevronRightIcon aria-hidden='true' />
			</Button>
		</div>
	);
}
