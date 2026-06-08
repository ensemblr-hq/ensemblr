import { CircleIcon } from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { formatCount } from '@/renderer/lib/format';
import type { ChecksPanelState } from '@/renderer/types/components';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import { ChecksEmptyMessage, ChecksSectionHeader } from './pr-metadata';
import { ChecksPanelSummary } from './summary';

export { ChecksEmptyMessage };

/** Empty-state shown when the workspace has no PR yet. */
export function ChecksNoPullRequestState({
	state,
	workspace,
}: {
	state: Extract<ChecksPanelState, { hasPullRequest: false }>;
	workspace: WorkspaceShellModel;
}) {
	const hasChanges = state.kind === 'uncommitted';

	return (
		<ScrollArea className='h-full overflow-hidden'>
			<div className='flex min-w-0 max-w-full flex-col gap-4 overflow-hidden p-3'>
				<ChecksPanelSummary state={state} />

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader label='Git status' />
					<ChecksActionRow
						actionLabel={hasChanges ? 'Create PR' : undefined}
						label='No PR open'
					/>
					{hasChanges ? (
						<ChecksActionRow
							actionLabel='Commit and push'
							label={formatCount(
								workspace.changeSummary.files,
								'uncommitted change',
							)}
						/>
					) : null}
				</section>

				<section className='flex min-w-0 flex-col gap-1.5'>
					<ChecksSectionHeader actionLabel='+ Add' label='Your todos' />
					<ChecksEmptyMessage label='No todos yet' />
				</section>
			</div>
		</ScrollArea>
	);
}

/** Reusable row with leading icon, label/detail text, and trailing action. */
function ChecksActionRow({
	actionLabel,
	label,
}: {
	actionLabel?: string;
	label: string;
}) {
	return (
		<div className='flex min-h-7 min-w-0 items-center justify-between gap-2 px-1'>
			<div className='flex min-w-0 items-center gap-2 overflow-hidden'>
				<CircleIcon
					aria-hidden='true'
					className='size-3 shrink-0 text-muted-foreground'
				/>
				<span className='min-w-0 truncate text-xs'>{label}</span>
			</div>
			{actionLabel ? (
				<Button
					className='h-6 px-1.5 text-muted-foreground text-xs hover:text-foreground'
					size='xs'
					variant='ghost'
				>
					{actionLabel}
				</Button>
			) : null}
		</div>
	);
}

