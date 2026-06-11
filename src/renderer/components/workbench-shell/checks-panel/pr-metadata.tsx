import { Button } from '@/renderer/components/ui/button';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

export function ChecksEmptyMessage({ label }: { label: string }) {
	return <p className='text-muted-foreground text-xs'>{label}</p>;
}

/** PR title and description block. */
export function PullRequestMetadata({
	pullRequest,
}: {
	pullRequest: WorkspaceShellModel['pullRequest'];
}) {
	return (
		<section className='flex min-w-0 flex-col gap-2'>
			<h2 className='min-w-0 truncate font-semibold text-sm'>
				{pullRequest.title || `Pull request #${pullRequest.number}`}
			</h2>
			<div className='flex min-w-0 flex-col gap-2 text-muted-foreground text-xs leading-4'>
				{pullRequest.description.length ? (
					pullRequest.description.map((paragraph) => (
						<p className='wrap-break-word min-w-0' key={paragraph}>
							{paragraph}
						</p>
					))
				) : (
					<ChecksEmptyMessage label='No description provided' />
				)}
			</div>
		</section>
	);
}

/** Section header used inside the checks panel (label + optional action). */
export function ChecksSectionHeader({
	actionLabel,
	label,
}: {
	actionLabel?: string;
	label: string;
}) {
	return (
		<div className='flex min-h-6 min-w-0 items-center justify-between gap-2'>
			<h3 className='font-semibold text-muted-foreground text-xs'>{label}</h3>
			{actionLabel ? (
				<Button className='h-6 px-1.5 text-xs' size='xs' variant='subtle'>
					{actionLabel}
				</Button>
			) : null}
		</div>
	);
}
