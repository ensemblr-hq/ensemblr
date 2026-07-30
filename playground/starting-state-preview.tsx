import { TimelineStartingState } from '@/renderer/components/workbench-shell/conversation-panel/timeline/timeline-starting-state';

const LABELS = ['Starting agent', 'Loading conversation'] as const;

/**
 * Both labels the empty-transcript startup affordance can carry, stacked so the
 * dot-matrix sweep and the caret can be eyeballed against each theme.
 */
export function StartingStatePreview() {
	return (
		<div className='flex flex-col gap-10'>
			{LABELS.map((label) => (
				<section
					className='flex min-h-0 flex-col'
					data-timeline-state='starting'
					key={label}
				>
					<TimelineStartingState label={label} />
				</section>
			))}
		</div>
	);
}
