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

import { Button } from '@/renderer/components/ui/button';
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from '@/renderer/components/ui/command';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/renderer/components/ui/popover';
import { cn } from '@/renderer/lib/utils';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import {
	classifyPermissionAction,
	DEFAULT_PERMISSION_MODE,
	getPermissionBoundaryLabel,
} from '@/shared/permissions';

const mergeBoundary = classifyPermissionAction({
	action: 'pull-request-merge',
	mode: DEFAULT_PERMISSION_MODE,
});
const mergeBoundaryLabel = getPermissionBoundaryLabel(mergeBoundary.boundary);

type RightSidebarHeaderState =
	| {
			kind: 'create-pr' | 'empty';
			tone: PullRequestHeaderTone;
	  }
	| {
			kind:
				| 'pr-blocked'
				| 'pr-checking'
				| 'pr-open'
				| 'pr-ready'
				| 'pr-working';
			label: string;
			number: number;
			previewDeployment?: WorkspaceShellModel['pullRequest']['previewDeployment'];
			tone: PullRequestHeaderTone;
			url?: string;
	  };

type PullRequestHeaderTone = 'blocked' | 'neutral' | 'pending' | 'ready';

export function RightSidebarHeader({
	activeWorkspace,
}: {
	activeWorkspace: WorkspaceShellModel;
}) {
	const headerState = getRightSidebarHeaderState(activeWorkspace);
	const hasPullRequestNumber = 'number' in headerState;
	const hasHeaderLabel = 'label' in headerState;

	return (
		<header
			className='native-toolbar right-sidebar-header flex h-12 w-full shrink-0 items-center gap-3 border-border border-b px-3'
			data-pr-tone={headerState.tone}
		>
			<div className='flex min-w-0 flex-1 items-center gap-2.5'>
				{hasPullRequestNumber ? (
					<div className='flex shrink-0 items-center gap-1'>
						<PullRequestNumberButton
							number={headerState.number}
							tone={headerState.tone}
							url={headerState.url}
						/>
						{headerState.previewDeployment ? (
							<PreviewDeploymentButton
								deployment={headerState.previewDeployment}
							/>
						) : null}
					</div>
				) : null}
				{hasHeaderLabel ? (
					<p
						className={cn(
							'min-w-0 truncate font-semibold text-sm leading-none',
							headerState.tone === 'ready' && 'text-status-ok',
							headerState.tone === 'pending' && 'text-foreground',
							headerState.tone === 'blocked' && 'text-status-danger',
							headerState.tone === 'neutral' && 'text-muted-foreground',
						)}
					>
						{headerState.label}
					</p>
				) : null}
			</div>
			<div className='ml-auto flex shrink-0 items-center justify-end'>
				{headerState.kind === 'pr-ready' ? (
					<Button
						className='h-7 rounded-md bg-status-ok px-2.5 text-primary-foreground hover:bg-status-ok/90'
						data-permission-boundary={mergeBoundary.boundary}
						size='sm'
					>
						<GitMergeIcon data-icon='inline-start' />
						Merge
						<span className='sr-only'>{mergeBoundaryLabel}</span>
					</Button>
				) : headerState.kind === 'pr-working' ||
					headerState.kind === 'pr-checking' ? (
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
				) : headerState.kind === 'create-pr' ? (
					<CreatePullRequestMenu />
				) : headerState.kind === 'pr-blocked' ||
					headerState.kind === 'pr-open' ? (
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
	url,
}: {
	number: number;
	tone: PullRequestHeaderTone;
	url?: string;
}) {
	const className = cn(
		'h-6.5 rounded-sm border px-1.75 font-semibold text-xs',
		tone === 'ready' &&
			'border-status-ok/35 bg-status-ok/10 text-status-ok hover:bg-status-ok/15',
		tone === 'pending' &&
			'border-status-warning/35 bg-status-warning/10 text-foreground hover:bg-status-warning/15',
		tone === 'blocked' &&
			'border-status-danger/35 bg-status-danger/10 text-status-danger hover:bg-status-danger/15',
		tone === 'neutral' &&
			'border-border bg-transparent text-muted-foreground hover:bg-muted/70',
	);
	const content = (
		<>
			<span className='font-mono tabular-nums'>#{number}</span>
			<ArrowUpRightIcon aria-hidden='true' className='size-3.5' />
		</>
	);

	if (url) {
		return (
			<Button
				aria-label={`Open pull request #${number}`}
				asChild
				className={className}
				size='sm'
				variant='outline'
			>
				<a href={url} rel='noreferrer' target='_blank'>
					{content}
				</a>
			</Button>
		);
	}

	return (
		<Button
			aria-label={`Open pull request #${number}`}
			className={className}
			size='sm'
			variant='outline'
		>
			{content}
		</Button>
	);
}

function PreviewDeploymentButton({
	deployment,
}: {
	deployment: NonNullable<
		WorkspaceShellModel['pullRequest']['previewDeployment']
	>;
}) {
	const providerLabel = getPreviewDeploymentProviderLabel(deployment.provider);
	const previewLabel =
		providerLabel === 'deployment'
			? 'preview deployment'
			: `${providerLabel} preview deployment`;

	return (
		<Button
			aria-label={`Open ${previewLabel}`}
			asChild
			className={cn(
				'h-6.5 rounded-sm border px-1.75 font-semibold text-xs',
				deployment.status === 'ready' &&
					'border-status-ok/35 bg-status-ok/10 text-status-ok hover:bg-status-ok/15',
				deployment.status === 'pending' &&
					'border-status-warning/35 bg-status-warning/10 text-foreground hover:bg-status-warning/15',
				deployment.status === 'blocked' &&
					'border-status-danger/35 bg-status-danger/10 text-status-danger hover:bg-status-danger/15',
			)}
			size='sm'
			variant='outline'
		>
			<a href={deployment.url} rel='noreferrer' target='_blank'>
				<span>{deployment.label}</span>
				<ExternalLinkIcon aria-hidden='true' className='size-3.5' />
			</a>
		</Button>
	);
}

function getPreviewDeploymentProviderLabel(
	provider: NonNullable<
		WorkspaceShellModel['pullRequest']['previewDeployment']
	>['provider'],
) {
	if (provider === 'vercel') {
		return 'Vercel';
	}

	if (provider === 'netlify') {
		return 'Netlify';
	}

	return 'deployment';
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

function getRightSidebarHeaderState(
	workspace: WorkspaceShellModel,
): RightSidebarHeaderState {
	const pullRequest = workspace.pullRequest;
	const pullRequestNumber = pullRequest.number;
	const hasPullRequestNumber = typeof pullRequestNumber === 'number';

	if (!hasPullRequestNumber) {
		return {
			kind: workspace.changeSummary.files > 0 ? 'create-pr' : 'empty',
			tone: 'neutral',
		};
	}

	if (pullRequest.status === 'ready-to-merge') {
		return {
			kind: 'pr-ready',
			label: pullRequest.label || 'Ready to merge',
			number: pullRequestNumber,
			previewDeployment: pullRequest.previewDeployment,
			tone: 'ready',
			url: pullRequest.url,
		};
	}

	if (pullRequest.status === 'checking') {
		return {
			kind: 'pr-checking',
			label: pullRequest.label,
			number: pullRequestNumber,
			previewDeployment: pullRequest.previewDeployment,
			tone: 'pending',
			url: pullRequest.url,
		};
	}

	if (pullRequest.status === 'blocked') {
		return {
			kind: 'pr-blocked',
			label: pullRequest.label,
			number: pullRequestNumber,
			previewDeployment: pullRequest.previewDeployment,
			tone: 'blocked',
			url: pullRequest.url,
		};
	}

	if (pullRequest.status === 'agent-working') {
		return {
			kind: 'pr-working',
			label: 'Working...',
			number: pullRequestNumber,
			previewDeployment: pullRequest.previewDeployment,
			tone: 'neutral',
			url: pullRequest.url,
		};
	}

	return {
		kind: 'pr-open',
		label:
			pullRequest.label ||
			pullRequest.title ||
			`PR #${pullRequestNumber.toString()}`,
		number: pullRequestNumber,
		previewDeployment: pullRequest.previewDeployment,
		tone: 'neutral',
		url: pullRequest.url,
	};
}
