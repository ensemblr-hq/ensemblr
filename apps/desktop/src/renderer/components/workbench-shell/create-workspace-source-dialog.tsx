import type { TFunction } from 'i18next';
import {
	GitBranchIcon,
	GitPullRequestIcon,
	TriangleAlertIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LinearProjectBadge } from '@/renderer/components/linear/issue-project';
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
	ToggleGroup,
	ToggleGroupItem,
} from '@/renderer/components/ui/toggle-group';
import { RepositoryPicker } from '@/renderer/components/workbench-shell/repository-picker';
import { useWorkspaceSourcePicker } from '@/renderer/hooks/workbench-shell/navigation-sidebar/use-workspace-source-picker';
import { useWorkspaceSourceSelection } from '@/renderer/hooks/workbench-shell/navigation-sidebar/use-workspace-source-selection';
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
import type { GithubFailure } from '@/shared/ipc/contracts/github';
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
	const { kind, repoId, search, selectedRepo, setKind, setRepoId, setSearch } =
		useWorkspaceSourceSelection({ open, project, projects });

	const { error, isLoading, itemsById, linearGap, sources, startedSources } =
		useWorkspaceSourcePicker({
			kind,
			open,
			projects,
			query: search,
			repoId,
		});
	const isEmpty = sources.length === 0 && startedSources.length === 0;
	// cmdk reorders groups by best match while searching, so an unheaded group
	// could land under the started heading and read as part of it.
	const startableHeading =
		startedSources.length > 0
			? t('workbench:board-status.backlog', 'Backlog')
			: undefined;

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
				<CommandInput
					onValueChange={setSearch}
					placeholder={searchPlaceholder(t, kind)}
					value={search}
				/>
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
				{linearGap && !isEmpty ? <LinearGapNote message={linearGap} /> : null}
				<CommandList className='max-h-80'>
					<SourceListPlaceholder
						error={error}
						isEmpty={isEmpty}
						isLoading={isLoading}
						isSearching={search.trim().length > 0}
						kind={kind}
						linearGap={linearGap}
					/>
					<SourceGroup
						heading={startableHeading}
						onAction={dispatchAction}
						sources={sources}
					/>
					<SourceGroup
						heading={t('linear:state-bucket.started', 'In progress')}
						onAction={dispatchAction}
						sources={startedSources}
					/>
				</CommandList>
			</Command>
		</CommandDialog>
	);
}

/**
 * One headed section of the picker list. Renders nothing without sources, so a
 * section that has no rows leaves no heading behind.
 */
function SourceGroup({
	heading,
	onAction,
	sources,
}: {
	heading: string | undefined;
	onAction: (source: WorkspaceSource, action: WorkspaceSourceAction) => void;
	sources: WorkspaceSource[];
}) {
	if (sources.length === 0) {
		return null;
	}

	return (
		<CommandGroup heading={heading}>
			{sources.map((source) => (
				<WorkspaceSourceRow
					key={source.id}
					onAction={onAction}
					source={source}
				/>
			))}
		</CommandGroup>
	);
}

/** What {@link SourceListPlaceholder} needs to decide what an empty list says. */
interface SourceListPlaceholderProps {
	/** The GitHub failure behind the active tab's list, if its read failed. */
	error: GithubFailure | null;
	isEmpty: boolean;
	isLoading: boolean;
	/** Whether the search input holds a query, which widens the Issues tab. */
	isSearching: boolean;
	kind: WorkspaceSourceKind;
	/** Why Linear rows may be missing from the Issues tab, already localized. */
	linearGap: string | null;
}

/**
 * What the source list shows in place of rows. The failure and loading banners
 * appear only while there is nothing to show yet — once cached rows exist they
 * render and a refetch happens silently, so the list never flashes a loading
 * state over real data. An empty, unsearched Issues tab is an ordinary state,
 * because it lists only work nobody has started, so it says so rather than
 * blaming a search nobody typed — unless Linear could not be read, when
 * "nothing to start" would be a false claim. A search also reaches started
 * issues, so a searched list with no rows falls to the search-miss message,
 * as every other empty list does.
 */
function SourceListPlaceholder({
	error,
	isEmpty,
	isLoading,
	isSearching,
	kind,
	linearGap,
}: SourceListPlaceholderProps) {
	const { t } = useTranslation();
	const sources = getWorkspaceSourceKindLabel(kind).toLowerCase();

	if (isEmpty && error) {
		return (
			<div className='px-3 py-8 text-destructive text-xs'>
				<p>{failureText(t, error)}</p>
				{error.remediation ? (
					<p className='mt-1 text-muted-foreground'>{error.remediation}</p>
				) : null}
			</div>
		);
	}

	if (isEmpty && isLoading) {
		return (
			<div className='py-8 text-center text-muted-foreground text-xs'>
				{t(
					'workbench:create-workspace-source.loading',
					'Loading {{sources}}…',
					{
						sources,
					},
				)}
			</div>
		);
	}

	if (isEmpty && linearGap) {
		return (
			<div className='px-3 py-8 text-destructive text-xs'>
				<p>{linearGap}</p>
			</div>
		);
	}

	if (isEmpty && kind === 'issue' && !isSearching) {
		return (
			<div className='px-6 py-8 text-center text-muted-foreground text-xs'>
				{t(
					'workbench:create-workspace-source.empty.issue',
					'No issues waiting to be started. Open GitHub issues and Linear issues in Backlog or Todo appear here until a workspace is created from them. Search to find Linear issues already in progress.',
				)}
			</div>
		);
	}

	return (
		<CommandEmpty className='py-8 text-muted-foreground text-xs'>
			{t(
				'workbench:create-workspace-source.no-match',
				'No {{sources}} match your search.',
				{ sources },
			)}
		</CommandEmpty>
	);
}

/**
 * Names the Linear rows a populated Issues tab is missing, pinned above the
 * list so it stays in view while the rows scroll. An empty tab says the same
 * thing through {@link SourceListPlaceholder} instead, so the two never show
 * together. It sits outside the list, whose `listbox` role admits only options
 * and groups.
 */
function LinearGapNote({ message }: { message: string }) {
	return (
		<p className='flex items-start gap-1.5 px-3 pt-2 pb-1 text-muted-foreground text-xs leading-5'>
			<TriangleAlertIcon
				aria-hidden='true'
				className='mt-0.5 size-3.5 shrink-0 text-status-warning'
			/>
			<span className='min-w-0'>{message}</span>
		</p>
	);
}

/**
 * One selectable source in the picker list. Selecting the row runs its primary
 * action; the trailing buttons run any action. Matched on its title, reference,
 * and tracker project as well as its id.
 */
function WorkspaceSourceRow({
	onAction,
	source,
}: {
	onAction: (source: WorkspaceSource, action: WorkspaceSourceAction) => void;
	source: WorkspaceSource;
}) {
	const actions = getWorkspaceSourceActions(source);
	const primaryAction = actions[0];

	return (
		<CommandItem
			className='h-11 gap-2 pr-1.5 pl-2'
			keywords={[
				source.title,
				source.reference ?? '',
				source.trackerProject ?? '',
			]}
			onSelect={() => {
				if (primaryAction) {
					onAction(source, primaryAction);
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
			{source.trackerProject ? (
				<LinearProjectBadge name={source.trackerProject} />
			) : null}
			<WorkspaceSourceActions
				actions={actions}
				onAction={(action) => onAction(source, action)}
			/>
		</CommandItem>
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
