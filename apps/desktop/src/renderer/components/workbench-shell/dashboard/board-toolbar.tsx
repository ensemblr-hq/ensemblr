import type { TFunction } from 'i18next';
import {
	ArrowUpDownIcon,
	FolderGit2Icon,
	LayersIcon,
	RefreshCwIcon,
	SearchIcon,
	XIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FacetItem, FacetPopover } from '@/renderer/components/facet-popover';
import { LinearAssigneeFacet } from '@/renderer/components/linear/assignee-facet';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select';
import { ProjectAvatar } from '@/renderer/components/workbench-shell/project-avatar';
import type { LinearAssigneeOption } from '@/renderer/lib/linear';
import {
	BOARD_CARD_SOURCES,
	BOARD_SORT_MODES,
	type BoardCardSource,
	type BoardFiltersState,
	type BoardSortMode,
} from '@/renderer/state/workspace';
import type { FacetCollapse } from '@/renderer/types/components';
import type { ProjectShellModel } from '@/renderer/types/workbench';

/**
 * Drops a control's text label once the dashboard header's container no longer
 * seats the whole toolbar, leaving the icon — and, on a facet holding a
 * selection, its count — to stand in for it. Every collapsed control names
 * itself through `aria-label` and `title`, so nothing becomes unreadable.
 * Only a host that declares `@container/dashboard-header` collapses anything;
 * anywhere else the named query never matches and the labels always show.
 */
const COLLAPSE_LABEL_TO_ICON = '@max-2xl/dashboard-header:hidden';

/**
 * The facet's selection count, which takes the collapsed label's place so the
 * row still says a filter is active. The plural noun stays in the label rather
 * than being concatenated onto this number.
 */
const REVEAL_WHEN_LABEL_COLLAPSED = 'hidden @max-2xl/dashboard-header:inline';

/** How every facet on the board collapses as the dashboard header narrows. */
const BOARD_FACET_COLLAPSE: FacetCollapse = {
	hideLabel: COLLAPSE_LABEL_TO_ICON,
	showCount: REVEAL_WHEN_LABEL_COLLAPSED,
};

/**
 * Collapses the sort control to its icon at the same width. The value is
 * squeezed to nothing rather than hidden because Radix lays an item-aligned menu
 * out from `getBoundingClientRect()` on the value node, and a `display: none`
 * one reports zeros — which makes it read the trigger's whole distance from the
 * window's left edge as menu width, opening a menu as wide as the window at
 * exactly the sizes this collapse exists for. The class rides a wrapper because
 * Radix drops `className` from `SelectValue` to keep that node measurable.
 */
const COLLAPSE_SORT_VALUE_TO_ICON =
	'@max-2xl/dashboard-header:w-0 @max-2xl/dashboard-header:overflow-hidden';

/**
 * Localized name of a card source, as the source facet lists it.
 * @param t - Translator bound to the active language.
 * @param source - The source to label.
 * @returns The facet row's label.
 */
function boardSourceLabel(t: TFunction, source: BoardCardSource): string {
	switch (source) {
		case 'workspace':
			return t('workbench:dashboard.toolbar.source.workspace', 'Workspaces');
		case 'linear':
			return t('workbench:dashboard.toolbar.source.linear', 'Linear issues');
		case 'github':
			return t('workbench:dashboard.toolbar.source.github', 'GitHub issues');
	}
}

/**
 * Localized name of a sort mode, as the sort control lists it.
 * @param t - Translator bound to the active language.
 * @param sort - The sort mode to label.
 * @returns The control's option label.
 */
function boardSortLabel(t: TFunction, sort: BoardSortMode): string {
	switch (sort) {
		case 'manual':
			return t('workbench:dashboard.toolbar.sort.manual', 'Manual order');
		case 'updated':
			return t('workbench:dashboard.toolbar.sort.updated', 'Recently updated');
		case 'priority':
			return t('workbench:dashboard.toolbar.sort.priority', 'Priority');
	}
}

/**
 * Filter and sort controls for the dashboard board: free-text search, a
 * repository facet, a source facet, a Linear assignee facet, and the column
 * sort. Every control writes straight to the persisted toolbar state, so the
 * board comes back the way the user left it. The assignee facet shows only
 * while Linear is connected, which `assigneeOptions` being null says it is not.
 */
export function BoardToolbar({
	assigneeOptions,
	filters: {
		clear,
		filters,
		setQuery,
		setSort,
		toggleAssignee,
		toggleRepo,
		toggleSource,
	},
	isRefreshing,
	onRefresh,
	projects,
}: {
	assigneeOptions: readonly LinearAssigneeOption[] | null;
	filters: BoardFiltersState;
	isRefreshing: boolean;
	onRefresh: () => void;
	projects: ProjectShellModel[];
}) {
	const { t } = useTranslation();
	const selectedRepoIds = useMemo(
		() => new Set(filters.repoIds),
		[filters.repoIds],
	);
	const selectedSources = useMemo(
		() => new Set(filters.sources),
		[filters.sources],
	);
	const hasFilters =
		filters.query.length > 0 ||
		filters.repoIds.length > 0 ||
		filters.sources.length > 0 ||
		filters.assignees.length > 0 ||
		filters.sort !== 'manual';

	return (
		<div className='ml-auto flex min-w-0 items-center gap-1.5'>
			<div className='relative w-44 min-w-24'>
				<SearchIcon
					aria-hidden='true'
					className='pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground'
				/>
				<Input
					aria-label={t(
						'workbench:dashboard.toolbar.search-aria',
						'Filter board cards',
					)}
					className='h-7 pl-7 text-xs'
					onChange={(event) => setQuery(event.target.value)}
					placeholder={t('workbench:dashboard.toolbar.search', 'Filter cards…')}
					value={filters.query}
				/>
			</div>
			<FacetPopover
				collapse={BOARD_FACET_COLLAPSE}
				count={filters.repoIds.length}
				icon={
					<FolderGit2Icon
						aria-hidden='true'
						className='size-3.5 text-muted-foreground'
					/>
				}
				label={
					filters.repoIds.length > 0
						? t('workbench:dashboard.toolbar.repository-count', {
								count: filters.repoIds.length,
								defaultValue_one: '{{count}} repository',
								defaultValue_other: '{{count}} repositories',
							})
						: t('workbench:dashboard.toolbar.repository', 'Repositories')
				}
				searchPlaceholder={t(
					'workbench:create-workspace-source.repository.search',
					'Search repositories…',
				)}
			>
				{projects.map((project) => (
					<FacetItem
						isSelected={selectedRepoIds.has(project.id)}
						key={project.id}
						label={project.name}
						onSelect={() => toggleRepo(project.id)}
						value={project.id}
					>
						<ProjectAvatar project={project} size='sm' />
					</FacetItem>
				))}
			</FacetPopover>
			<FacetPopover
				collapse={BOARD_FACET_COLLAPSE}
				count={filters.sources.length}
				icon={
					<LayersIcon
						aria-hidden='true'
						className='size-3.5 text-muted-foreground'
					/>
				}
				label={
					filters.sources.length > 0
						? t('workbench:dashboard.toolbar.source-count', {
								count: filters.sources.length,
								defaultValue_one: '{{count}} source',
								defaultValue_other: '{{count}} sources',
							})
						: t('workbench:dashboard.toolbar.sources', 'Sources')
				}
				searchPlaceholder={t(
					'workbench:dashboard.toolbar.source-search',
					'Search sources…',
				)}
			>
				{BOARD_CARD_SOURCES.map((source) => (
					<FacetItem
						isSelected={selectedSources.has(source)}
						key={source}
						label={boardSourceLabel(t, source)}
						onSelect={() => toggleSource(source)}
						value={source}
					/>
				))}
			</FacetPopover>
			{assigneeOptions ? (
				<LinearAssigneeFacet
					collapse={BOARD_FACET_COLLAPSE}
					onToggle={toggleAssignee}
					options={assigneeOptions}
					selection={filters.assignees}
				/>
			) : null}
			<Select
				onValueChange={(next) => setSort(next as BoardSortMode)}
				value={filters.sort}
			>
				<SelectTrigger
					aria-label={t('workbench:dashboard.toolbar.sort-aria', 'Sort cards')}
					className='h-7 shrink-0 gap-1.5 text-xs'
					size='sm'
					title={boardSortLabel(t, filters.sort)}
				>
					<ArrowUpDownIcon
						aria-hidden='true'
						className='size-3.5 text-muted-foreground'
					/>
					<span className={COLLAPSE_SORT_VALUE_TO_ICON}>
						<SelectValue />
					</span>
				</SelectTrigger>
				<SelectContent>
					{BOARD_SORT_MODES.map((sort) => (
						<SelectItem key={sort} value={sort}>
							{boardSortLabel(t, sort)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{hasFilters ? (
				<Button
					aria-label={t(
						'workbench:dashboard.toolbar.clear',
						'Clear board filters',
					)}
					onClick={clear}
					size='icon-sm'
					variant='ghost'
				>
					<XIcon aria-hidden='true' />
				</Button>
			) : null}
			<Button
				aria-label={t(
					'workbench:dashboard.toolbar.refresh',
					'Refresh issues from GitHub and Linear',
				)}
				disabled={isRefreshing}
				onClick={onRefresh}
				size='icon-sm'
				variant='ghost'
			>
				<RefreshCwIcon
					aria-hidden='true'
					className={isRefreshing ? 'animate-spin' : undefined}
				/>
			</Button>
		</div>
	);
}
