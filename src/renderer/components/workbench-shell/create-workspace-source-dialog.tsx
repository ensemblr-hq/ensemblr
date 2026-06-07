import {
	CheckIcon,
	ChevronsUpDownIcon,
	FolderGit2Icon,
	GitBranchIcon,
	GitPullRequestIcon,
	GlobeIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/renderer/components/ui/button';
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/renderer/components/ui/command';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/renderer/components/ui/popover';
import {
	ToggleGroup,
	ToggleGroupItem,
} from '@/renderer/components/ui/toggle-group';
import {
	filterWorkspaceSourcesByKind,
	getWorkspaceSourceActions,
	getWorkspaceSourceKindLabel,
	WORKSPACE_SOURCE_KINDS,
} from '@/renderer/lib/workbench';
import { defaultWorkspaceSources } from '@/renderer/mocks/workbench';
import type {
	ProjectShellModel,
	WorkspaceSource,
	WorkspaceSourceAction,
	WorkspaceSourceKind,
} from '@/renderer/types/workbench';

import { ProjectAvatar } from './project-avatar';
import { GithubLogo, LinearLogo } from './source-provider-logo';

const searchPlaceholders: Record<WorkspaceSourceKind, string> = {
	branch: 'Search by name',
	issue: 'Search by issue number, title, or description',
	'pull-request': 'Search by title, number, or author',
};

/** Command-palette dialog for creating a workspace from a branch, PR, or issue. */
export function CreateWorkspaceSourceDialog({
	onCreateWorkspace,
	onOpenChange,
	open,
	project,
	projects,
	sources = defaultWorkspaceSources,
}: {
	onCreateWorkspace?: (input: {
		action: WorkspaceSourceAction;
		repoId: string;
		source: WorkspaceSource;
	}) => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	project: ProjectShellModel | null;
	projects: ProjectShellModel[];
	sources?: WorkspaceSource[];
}) {
	const [kind, setKind] = useState<WorkspaceSourceKind>('pull-request');
	const [repoId, setRepoId] = useState(project?.id ?? projects[0]?.id ?? '');

	const visibleSources = useMemo(
		() => filterWorkspaceSourcesByKind(sources, kind),
		[sources, kind],
	);
	const selectedRepo =
		projects.find((candidate) => candidate.id === repoId) ?? project ?? null;

	// Reset the picker to the chosen repository each time the dialog opens.
	const [wasOpen, setWasOpen] = useState(open);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open && project) {
			setRepoId(project.id);
			setKind('pull-request');
		}
	}

	/** Forwards an action selection to the parent and closes the dialog. */
	const dispatchAction = (
		source: WorkspaceSource,
		action: WorkspaceSourceAction,
	) => {
		onCreateWorkspace?.({ action, repoId, source });
		onOpenChange(false);
	};

	return (
		<CommandDialog
			className='max-w-xl translate-y-0 sm:max-w-xl'
			description='Choose a branch, pull request, or issue to start a workspace.'
			onOpenChange={onOpenChange}
			open={open}
			title='Create workspace from source'
		>
			<Command className='rounded-xl border-0'>
				<CommandInput placeholder={searchPlaceholders[kind]} />
				<div className='flex items-center justify-between gap-2 px-1.5 py-1'>
					<ToggleGroup
						onValueChange={(next) => {
							if (next) {
								setKind(next as WorkspaceSourceKind);
							}
						}}
						type='single'
						value={kind}
					>
						{WORKSPACE_SOURCE_KINDS.map((sourceKind) => (
							<ToggleGroupItem
								className='h-7 rounded-md px-2.5 font-medium text-muted-foreground text-xs data-[state=on]:bg-muted data-[state=on]:text-foreground'
								key={sourceKind}
								value={sourceKind}
							>
								{getWorkspaceSourceKindLabel(sourceKind)}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
					<WorkspaceRepoSelector
						onSelect={setRepoId}
						projects={projects}
						selectedRepo={selectedRepo}
					/>
				</div>
				<CommandList className='max-h-80 border-border border-t'>
					<CommandEmpty className='py-8 text-muted-foreground text-xs'>
						No {getWorkspaceSourceKindLabel(kind).toLowerCase()} match your
						search.
					</CommandEmpty>
					<CommandGroup>
						{visibleSources.map((source) => {
							const actions = getWorkspaceSourceActions(source);
							const primaryAction = actions[0];

							return (
								<CommandItem
									className='h-11 gap-2 pr-1.5 pl-2'
									key={source.id}
									keywords={[source.title, source.reference ?? '']}
									onSelect={() => {
										if (primaryAction) {
											dispatchAction(source, primaryAction);
										}
									}}
									value={source.id}
								>
									<WorkspaceSourceIcon source={source} />
									<span className='flex min-w-0 flex-1 items-center gap-1 p-1.5'>
										{source.reference ? (
											<span className='shrink-0 font-mono text-muted-foreground text-xxs'>
												[{source.reference}]
											</span>
										) : null}
										<span className='truncate text-[0.8125rem] leading-5'>
											{source.title}
										</span>
									</span>
									<WorkspaceSourceActions
										actions={actions}
										onAction={(action) => dispatchAction(source, action)}
									/>
								</CommandItem>
							);
						})}
					</CommandGroup>
				</CommandList>
			</Command>
		</CommandDialog>
	);
}

/** Trailing action buttons rendered next to a workspace-source row on hover. */
function WorkspaceSourceActions({
	actions,
	onAction,
}: {
	actions: WorkspaceSourceAction[];
	onAction: (action: WorkspaceSourceAction) => void;
}) {
	return (
		<span
			className='ml-auto hidden shrink-0 items-center gap-1.5 pl-2 group-hover/command-item:flex group-aria-selected/command-item:flex'
			data-slot='command-shortcut'
		>
			{actions.map((action) => (
				<Button
					className={
						action.variant === 'primary'
							? 'h-6 gap-1.5 bg-foreground px-2 text-background text-xs hover:bg-foreground/90 hover:text-background'
							: 'h-6 gap-1.5 border border-border bg-popover px-2 text-foreground text-xs hover:bg-foreground/10 hover:text-foreground'
					}
					data-action-id={action.id}
					key={action.id}
					onClick={(event) => {
						event.stopPropagation();
						onAction(action);
					}}
					size='sm'
					variant='ghost'
					text-xxs
				>
					{action.label}
					<span className='text-xxs opacity-70'>{action.shortcut}</span>
				</Button>
			))}
		</span>
	);
}

/** Popover with repository picker, narrowing the dialog's source list. */
function WorkspaceRepoSelector({
	onSelect,
	projects,
	selectedRepo,
}: {
	onSelect: (repoId: string) => void;
	projects: ProjectShellModel[];
	selectedRepo: ProjectShellModel | null;
}) {
	const [open, setOpen] = useState(false);

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger asChild>
				<Button
					className='h-7 shrink-0 gap-1.5 pr-1.5 pl-1 font-medium text-xs'
					size='sm'
					variant='ghost'
				>
					{selectedRepo ? (
						<ProjectAvatar project={selectedRepo} size='sm' />
					) : (
						<FolderGit2Icon
							aria-hidden='true'
							className='size-4 text-muted-foreground'
						/>
					)}
					<span className='max-w-32 truncate'>
						{selectedRepo?.name ?? 'Select repository'}
					</span>
					<ChevronsUpDownIcon
						aria-hidden='true'
						className='size-3.5 text-muted-foreground'
					/>
				</Button>
			</PopoverTrigger>
			<PopoverContent align='end' className='w-64 overflow-hidden p-0'>
				<Command>
					<CommandInput placeholder='Search repositories…' />
					<CommandList>
						<CommandEmpty className='py-6 text-muted-foreground text-xs'>
							No repositories found.
						</CommandEmpty>
						<CommandGroup>
							{projects.map((candidate) => (
								<CommandItem
									className='gap-2'
									key={candidate.id}
									keywords={[candidate.name]}
									onSelect={() => {
										onSelect(candidate.id);
										setOpen(false);
									}}
									value={candidate.id}
								>
									<span className='flex w-4 shrink-0 items-center justify-center'>
										{candidate.id === selectedRepo?.id ? (
											<CheckIcon aria-hidden='true' className='size-4' />
										) : null}
									</span>
									<ProjectAvatar project={candidate} size='sm' />
									<span className='min-w-0 flex-1 truncate text-[0.8125rem]'>
										{candidate.name}
									</span>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

/** Renders the appropriate provider/kind icon for a workspace source row. */
function WorkspaceSourceIcon({ source }: { source: WorkspaceSource }) {
	const className = 'size-4 shrink-0 text-muted-foreground';

	if (source.kind === 'pull-request') {
		return <GitPullRequestIcon aria-hidden='true' className={className} />;
	}

	if (source.kind === 'issue') {
		return source.provider === 'linear' ? (
			<LinearLogo className={className} />
		) : (
			<GithubLogo className={className} />
		);
	}

	return source.provider === 'local-git' ? (
		<GitBranchIcon aria-hidden='true' className={className} />
	) : (
		<GlobeIcon aria-hidden='true' className={className} />
	);
}
