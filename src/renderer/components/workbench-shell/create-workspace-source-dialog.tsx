import type { TFunction } from 'i18next';
import {
	CheckIcon,
	ChevronsUpDownIcon,
	FolderGit2Icon,
	GitBranchIcon,
	GitPullRequestIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/renderer/components/ui/button';
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
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
import { RepositoryPicker } from '@/renderer/components/workbench-shell/repository-picker';
import { useWorkspaceSourcePicker } from '@/renderer/hooks/workbench-shell/navigation-sidebar/use-workspace-source-picker';
import { failureText } from '@/renderer/lib/failure-text';
import {
	getWorkspaceSourceActions,
	getWorkspaceSourceKindLabel,
	openableWorkspaceId,
	WORKSPACE_SOURCE_KINDS,
	workspaceSeedFromSourceItem,
} from '@/renderer/lib/workbench';
import type {
	ProjectShellModel,
	WorkspaceCreationSeed,
	WorkspaceSource,
	WorkspaceSourceAction,
	WorkspaceSourceKind,
} from '@/renderer/types/workbench';
import { ProjectAvatar } from './project-avatar';
import { GithubLogo, LinearLogo } from './source-provider-logo';

/**
 * Resolve the command-input placeholder for the selected source kind.
 * @param t - Translator from `useTranslation`.
 * @param kind - The source kind currently selected in the toggle group.
 * @returns The localized placeholder for that kind.
 */
function searchPlaceholder(t: TFunction, kind: WorkspaceSourceKind): string {
	const placeholders: Record<WorkspaceSourceKind, string> = {
		branch: t(
			'workbench:create-workspace-source.search.branch',
			'Search by name',
		),
		issue: t(
			'workbench:create-workspace-source.search.issue',
			'Search by issue number, title, or description',
		),
		'pull-request': t(
			'workbench:create-workspace-source.search.pull-request',
			'Search by title, number, or author',
		),
	};
	return placeholders[kind];
}

/** Command-palette dialog for creating a workspace from a branch, PR, or issue. */
export function CreateWorkspaceSourceDialog({
	onCreateWorkspace,
	onOpenChange,
	onOpenWorkspace,
	open,
	project,
	projects,
}: {
	onCreateWorkspace?: (input: {
		repoId: string;
		seed: WorkspaceCreationSeed;
	}) => void;
	onOpenChange: (open: boolean) => void;
	onOpenWorkspace?: (input: { repoId: string; workspaceId: string }) => void;
	open: boolean;
	project: ProjectShellModel | null;
	projects: ProjectShellModel[];
}) {
	const { t } = useTranslation();
	const [kind, setKind] = useState<WorkspaceSourceKind>('pull-request');
	const [repoId, setRepoId] = useState(project?.id ?? projects[0]?.id ?? '');

	const { error, isLoading, itemsById, sources } = useWorkspaceSourcePicker({
		kind,
		open,
		repoId,
	});
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

	/** Turns a selected source into a create-or-open action, then closes. */
	const dispatchAction = (
		source: WorkspaceSource,
		action: WorkspaceSourceAction,
	) => {
		const item = itemsById.get(source.id);
		if (item) {
			const existingWorkspaceId = openableWorkspaceId(item, action.id);
			if (existingWorkspaceId) {
				onOpenWorkspace?.({ repoId, workspaceId: existingWorkspaceId });
			} else {
				onCreateWorkspace?.({
					repoId,
					seed: workspaceSeedFromSourceItem(item, action.id),
				});
			}
		}
		onOpenChange(false);
	};

	return (
		<CommandDialog
			className='max-w-xl translate-y-0 sm:max-w-xl'
			description={t(
				'workbench:create-workspace-source.description',
				'Choose a branch, pull request, or issue to start a workspace.',
			)}
			onOpenChange={onOpenChange}
			open={open}
			title={t(
				'workbench:create-workspace-source.title',
				'Create workspace from source',
			)}
		>
			<Command className='rounded-xl border-0'>
				<CommandInput placeholder={searchPlaceholder(t, kind)} />
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
								className='h-7 rounded-md px-2.5 text-xs'
								key={sourceKind}
								value={sourceKind}
							>
								{getWorkspaceSourceKindLabel(sourceKind)}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
					<RepositoryPicker
						onSelect={setRepoId}
						projects={projects}
						selectedRepo={selectedRepo}
					/>
				</div>
				<CommandSeparator alwaysRender />
				<CommandList className='max-h-80'>
					{/* Banners only when there is nothing to show yet — once cached rows
					    exist we render them and let a refetch happen silently, so the
					    list never flashes a loading state over real data. */}
					{sources.length === 0 && error ? (
						<div className='px-3 py-8 text-destructive text-xs'>
							<p>{failureText(t, error)}</p>
							{error.remediation ? (
								<p className='mt-1 text-muted-foreground'>
									{error.remediation}
								</p>
							) : null}
						</div>
					) : sources.length === 0 && isLoading ? (
						<div className='py-8 text-center text-muted-foreground text-xs'>
							{t(
								'workbench:create-workspace-source.loading',
								'Loading {{sources}}…',
								{ sources: getWorkspaceSourceKindLabel(kind).toLowerCase() },
							)}
						</div>
					) : (
						<CommandEmpty className='py-8 text-muted-foreground text-xs'>
							{t(
								'workbench:create-workspace-source.no-match',
								'No {{sources}} match your search.',
								{ sources: getWorkspaceSourceKindLabel(kind).toLowerCase() },
							)}
						</CommandEmpty>
					)}
					<CommandGroup>
						{sources.map((source) => {
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
							? 'h-6 gap-1.5 bg-foreground px-2 text-background text-xs hover:bg-foreground/80 hover:text-background dark:hover:bg-foreground/80'
							: 'h-6 gap-1.5 border border-border bg-popover px-2 text-foreground text-xs hover:bg-foreground/10 hover:text-foreground dark:hover:bg-foreground/10'
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

	return <GitBranchIcon aria-hidden='true' className={className} />;
}
