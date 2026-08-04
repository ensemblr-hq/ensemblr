import { UnfoldVerticalIcon } from 'lucide-react';

/**
 * Band marking where a diff skipped unchanged lines, so the jump in line numbers
 * reads as a deliberate boundary between two changed blocks rather than as
 * missing content.
 *
 * Set in the app's sans face against the mono code around it: the band is chrome
 * describing the diff, not a line of it. Shared by the full diff viewer and the
 * compact preview inside a tool row so the boundary looks the same in both.
 */
export function CodeHunkGap({ label }: { label: string }) {
	return (
		<div
			className='flex select-none items-center gap-1.5 border-code-border border-y bg-muted/40 px-2 py-0.5 font-sans text-muted-foreground text-xxs'
			data-slot='code-hunk-gap'
		>
			<UnfoldVerticalIcon aria-hidden='true' className='size-3 shrink-0' />
			{label}
		</div>
	);
}
