import type { ReactNode } from 'react';

import { ConciergeToggleRow } from '@/renderer/components/concierge';

/** Which shell screen the stand-in imitates, and so where the toggle sits. */
export type ConciergeStageScreen = 'other' | 'workspace';

/**
 * The shell around the Concierge toggle, in both of the places the app puts it:
 * under the terminal dock in the workspace's review rail, and along the foot of
 * every other screen's content area.
 *
 * The toggle row is the shipped component; the rail and the dock around it are
 * stand-ins drawn to the same widths and heights, so the row is judged against
 * the chrome it actually shares a column with.
 */
export function ConciergeToggleStage({
	children,
	screen,
}: {
	children: ReactNode;
	screen: ConciergeStageScreen;
}) {
	if (screen === 'other') {
		return (
			<>
				<div className='flex min-h-0 flex-1 flex-col overflow-auto p-6'>
					{children}
				</div>
				<ConciergeToggleRow />
			</>
		);
	}

	return (
		<div className='flex min-h-0 flex-1'>
			<div className='flex min-w-0 flex-1 flex-col overflow-auto p-6'>
				{children}
			</div>
			<StandInReviewRail />
		</div>
	);
}

/**
 * A review rail reduced to its outline: the review surface, the terminal dock's
 * tab strip and output, and the shipped toggle row beneath them.
 */
function StandInReviewRail() {
	return (
		<aside className='flex w-88 shrink-0 flex-col border-border border-l bg-card'>
			<div className='flex-1 p-3 text-muted-foreground text-xs'>
				review surface — files, changes, checks
			</div>
			<div className='flex h-56 shrink-0 flex-col border-border border-t'>
				<div className='flex h-9 shrink-0 items-center gap-3 px-3 text-muted-foreground text-xs shadow-bottom-rule'>
					<span className='text-foreground'>Setup</span>
					<span>Run</span>
					<span>Terminal</span>
				</div>
				<pre className='flex-1 overflow-hidden bg-background p-3 font-mono text-muted-foreground text-xxs'>
					{'$ bun run dev\nready in 412 ms'}
				</pre>
			</div>
			<ConciergeToggleRow />
		</aside>
	);
}
