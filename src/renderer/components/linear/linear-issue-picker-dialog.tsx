import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import {
	linearConnectionQuery,
	linearIssuesQuery,
} from '@/renderer/api/ensemblr';
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/renderer/components/ui/command';
import { LinearLogo } from '@/renderer/components/workbench-shell/source-provider-logo';
import { deriveLinearGateState } from '@/renderer/lib/linear';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';

import { LinearStateBadge } from './issue-meta-badges';

/** Command-palette picker for selecting one Linear issue. */
export function LinearIssuePickerDialog({
	onOpenChange,
	onSelect,
	open,
}: {
	onOpenChange: (open: boolean) => void;
	onSelect: (issue: LinearIssueWire) => void;
	open: boolean;
}) {
	const [query, setQuery] = useState('');
	const { data: connectionData, isLoading: connectionLoading } = useQuery({
		...linearConnectionQuery,
		enabled: open,
	});
	const { data: issuesData, isLoading: issuesLoading } = useQuery({
		...linearIssuesQuery(query ? { query } : {}),
		enabled: open,
	});

	const gate = deriveLinearGateState({
		connection: connectionData,
		isLoading: connectionLoading,
	});
	const rows = issuesData?.issues ?? [];

	return (
		<CommandDialog
			className='max-w-xl translate-y-0 sm:max-w-xl'
			description='Search Linear issues and pick one to link.'
			onOpenChange={onOpenChange}
			open={open}
			title='Link Linear issue'
		>
			<Command className='rounded-xl border-0' shouldFilter={false}>
				<CommandInput
					onValueChange={setQuery}
					placeholder='Search by identifier or title…'
					value={query}
				/>
				<CommandList className='max-h-80 border-border border-t'>
					<CommandEmpty className='py-8 text-muted-foreground text-xs'>
						{gate.kind === 'ready'
							? issuesLoading
								? 'Loading issues…'
								: 'No issues match your search.'
							: 'Linear is not connected. Sign in from integration settings.'}
					</CommandEmpty>
					{gate.kind === 'ready' ? (
						<CommandGroup>
							{rows.map((issue) => (
								<CommandItem
									className='h-11 gap-2 pr-2 pl-2'
									key={issue.id}
									keywords={[issue.identifier, issue.title]}
									onSelect={() => {
										onSelect(issue);
										onOpenChange(false);
									}}
									value={issue.id}
								>
									<LinearLogo className='size-4 shrink-0 text-muted-foreground' />
									<span className='shrink-0 font-mono text-muted-foreground text-xxs'>
										{issue.identifier}
									</span>
									<span className='min-w-0 flex-1 truncate text-[0.8125rem]'>
										{issue.title}
									</span>
									<LinearStateBadge
										color={issue.stateColor}
										name={issue.stateName}
									/>
								</CommandItem>
							))}
						</CommandGroup>
					) : null}
				</CommandList>
			</Command>
		</CommandDialog>
	);
}
