import {
	ArrowUpRightIcon,
	ChevronDownIcon,
	ExternalLinkIcon,
	GitMergeIcon,
	GitPullRequestCreateIcon,
	GitPullRequestDraftIcon,
	LoaderCircleIcon,
	MoreVerticalIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from '@/components/ui/command';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { WorkspaceShellModel } from '@/renderer/workbench/workbench-model';

export function RightSidebarHeader({
	activeWorkspace,
}: {
	activeWorkspace: WorkspaceShellModel;
}) {
	const pullRequest = activeWorkspace.pullRequest;
	const headerTone = getPullRequestHeaderTone(pullRequest.status);
	const isMergeReady = headerTone === 'ready';
	const isInFlight =
		pullRequest.status === 'agent-working' || pullRequest.status === 'checking';
	const pullRequestNumber = pullRequest.number;
	const hasPullRequestNumber = typeof pullRequestNumber === 'number';
	const hasWorkspaceChanges = activeWorkspace.changeSummary.files > 0;
	const shouldShowHeaderLabel =
		hasPullRequestNumber || headerTone !== 'neutral';

	return (
		<header
			className='native-toolbar right-sidebar-header flex h-12 w-full shrink-0 items-center gap-3 border-border border-b px-3'
			data-pr-tone={headerTone}
		>
			<div className='flex min-w-0 flex-1 items-center gap-2.5'>
				{hasPullRequestNumber ? (
					<PullRequestNumberButton
						number={pullRequestNumber}
						tone={headerTone}
					/>
				) : null}
				{shouldShowHeaderLabel ? (
					<p
						className={cn(
							'min-w-0 truncate font-semibold text-sm leading-none',
							headerTone === 'ready' && 'text-status-ok',
							headerTone === 'pending' && 'text-foreground',
							headerTone === 'blocked' && 'text-status-danger',
							headerTone === 'neutral' && 'text-muted-foreground',
						)}
					>
						{getPullRequestHeaderLabel(pullRequest)}
					</p>
				) : null}
			</div>
			<div className='ml-auto flex shrink-0 items-center justify-end'>
				{isMergeReady ? (
					<Button
						className='h-7 rounded-md bg-status-ok px-2.5 text-primary-foreground hover:bg-status-ok/90'
						size='sm'
					>
						<GitMergeIcon data-icon='inline-start' />
						Merge
					</Button>
				) : isInFlight && hasPullRequestNumber ? (
					<div
						aria-label='Pull request activity in progress'
						className='grid size-7 place-items-center text-muted-foreground'
						role='status'
					>
						<LoaderCircleIcon
							aria-hidden='true'
							className='size-4 animate-spin'
						/>
					</div>
				) : hasWorkspaceChanges && !hasPullRequestNumber ? (
					<CreatePullRequestMenu />
				) : headerTone !== 'neutral' ? (
					<Button size='icon-sm' variant='ghost'>
						<MoreVerticalIcon />
						<span className='sr-only'>Open pull request menu</span>
					</Button>
				) : null}
			</div>
		</header>
	);
}

function PullRequestNumberButton({
	number,
	tone,
}: {
	number: number;
	tone: 'blocked' | 'neutral' | 'pending' | 'ready';
}) {
	return (
		<Button
			aria-label={`Open pull request #${number}`}
			className={cn(
				'h-6.5 rounded-sm border px-1.75 font-semibold text-xs',
				tone === 'ready' &&
					'border-status-ok/35 bg-status-ok/10 text-status-ok hover:bg-status-ok/15',
				tone === 'pending' &&
					'border-status-warning/35 bg-status-warning/10 text-foreground hover:bg-status-warning/15',
				tone === 'blocked' &&
					'border-status-danger/35 bg-status-danger/10 text-status-danger hover:bg-status-danger/15',
				tone === 'neutral' &&
					'border-border bg-transparent text-muted-foreground hover:bg-muted/70',
			)}
			size='sm'
			variant='outline'
		>
			<span className='font-mono tabular-nums'>#{number}</span>
			<ArrowUpRightIcon aria-hidden='true' className='size-3.5' />
		</Button>
	);
}

function CreatePullRequestMenu() {
	const [isOpen, setIsOpen] = useState(false);
	const closeMenu = () => setIsOpen(false);

	return (
		<div className='flex h-7 shrink-0 items-center overflow-hidden rounded-md border border-border bg-background'>
			<Button
				className='h-7 rounded-none border-0 bg-transparent px-2.5'
				size='sm'
				variant='ghost'
			>
				<GitPullRequestCreateIcon data-icon='inline-start' />
				Create PR
			</Button>
			<span aria-hidden='true' className='h-4 w-px shrink-0 bg-border' />
			<Popover onOpenChange={setIsOpen} open={isOpen}>
				<PopoverTrigger asChild>
					<Button
						aria-label='Open create pull request options'
						className='size-7 rounded-none border-0 bg-transparent'
						size='icon-sm'
						variant='ghost'
					>
						<ChevronDownIcon aria-hidden='true' />
					</Button>
				</PopoverTrigger>
				<PopoverContent
					align='end'
					className='w-64 overflow-hidden p-0'
					onOpenAutoFocus={(event) => event.preventDefault()}
				>
					<Command>
						<CommandInput placeholder='Create PR action...' />
						<CommandList>
							<CommandEmpty>No PR actions found.</CommandEmpty>
							<CommandGroup heading='Pull request'>
								<CommandItem onSelect={closeMenu} value='create draft pr'>
									<GitPullRequestDraftIcon aria-hidden='true' />
									<span>Create draft PR</span>
									<CommandShortcut>Draft</CommandShortcut>
								</CommandItem>
								<CommandItem onSelect={closeMenu} value='create pr manually'>
									<ExternalLinkIcon aria-hidden='true' />
									<span>Create PR manually</span>
									<CommandShortcut>Web</CommandShortcut>
								</CommandItem>
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	);
}

function getPullRequestHeaderTone(
	status: WorkspaceShellModel['pullRequest']['status'],
): 'blocked' | 'neutral' | 'pending' | 'ready' {
	if (status === 'ready-to-merge') {
		return 'ready';
	}

	if (status === 'checking') {
		return 'pending';
	}

	if (status === 'blocked') {
		return 'blocked';
	}

	return 'neutral';
}

function getPullRequestHeaderLabel({
	label,
	status,
}: WorkspaceShellModel['pullRequest']) {
	if (status === 'idle' || status === 'agent-working') {
		return 'Working...';
	}

	return label;
}
