import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { cn } from '@/renderer/lib/utils';
import {
	BOARD_STATUS_PRESENTATION,
	boardStatusLabel,
} from '@/renderer/lib/workbench/board-status-presentation';
import type { WorkspaceBoardStatus } from '@/renderer/state/workspace';
import type {
	BoardCard,
	BoardIssueCard,
	BoardIssuesFailure,
} from '@/renderer/types/workbench-shell';
import { BacklogIssuesError } from './backlog-issues-error';
import { IssueCard } from './issue-card';
import { BOARD_CARD_DRAG_TYPE } from './use-card-dnd';
import { WorkspaceCard } from './workspace-card';

/** Per-column callbacks a card fires; issue cards use all three, workspaces none. */
export interface BoardColumnActions {
	onAssignIssue: (
		issue: BoardIssueCard,
		targetStatus: WorkspaceBoardStatus,
	) => void;
	onDismissIssue: (issueKey: string) => void;
	onOpenWorkspace: (projectId: string, workspaceId: string) => void;
	onRestoreIssue: (issueKey: string) => void;
}

/**
 * A single dashboard board column for one board status. Acts as a drop target
 * for both card kinds; what a drop means is decided by `planBoardDrop`. Backlog
 * additionally names every repository whose `gh` list failed, since a silently
 * short list would read as "nothing to do".
 */
export function BoardColumn({
	actions,
	allowReorder,
	cards,
	isLoadingIssues,
	issuesErrors,
	status,
	totalCount,
}: {
	actions: BoardColumnActions;
	/** False under a non-manual sort, which decides card order itself. */
	allowReorder: boolean;
	cards: BoardCard[];
	/** True while Backlog's issue lists are still in flight. */
	isLoadingIssues: boolean;
	issuesErrors: readonly BoardIssuesFailure[];
	status: WorkspaceBoardStatus;
	/** Cards the column holds before the toolbar's filters narrow it. */
	totalCount: number;
}) {
	const { t } = useTranslation();
	const ref = useRef<HTMLDivElement | null>(null);
	const [isDraggedOver, setIsDraggedOver] = useState(false);
	const presentation = BOARD_STATUS_PRESENTATION[status];
	const StatusIcon = presentation.icon;
	const statusLabel = boardStatusLabel(t, status);
	const isFiltered = cards.length !== totalCount;

	useEffect(() => {
		const element = ref.current;
		if (!element) {
			return undefined;
		}
		return dropTargetForElements({
			element,
			canDrop: ({ source }) => source.data.type === BOARD_CARD_DRAG_TYPE,
			getData: () => ({ type: 'board-column', status }),
			onDragEnter: () => setIsDraggedOver(true),
			onDragLeave: () => setIsDraggedOver(false),
			onDrop: () => setIsDraggedOver(false),
		});
	}, [status]);

	return (
		<section
			aria-label={
				isFiltered
					? t(
							'workbench:dashboard.column.label-filtered',
							'{{status}} column, {{shown}} of {{total}} cards shown',
							{ shown: cards.length, status: statusLabel, total: totalCount },
						)
					: t(
							'workbench:dashboard.column.label',
							'{{status}} column, {{cards}}',
							{
								cards: t('workbench:dashboard.column.card-count', {
									count: cards.length,
									defaultValue_one: '{{count}} card',
									defaultValue_other: '{{count}} cards',
								}),
								status: statusLabel,
							},
						)
			}
			className={cn(
				'flex w-72 shrink-0 flex-col rounded-xl bg-muted/40 ring-1 ring-transparent transition-colors',
				isDraggedOver && 'bg-muted ring-primary/30',
			)}
			ref={ref}
		>
			<div className='flex items-center gap-2 px-3 py-2.5'>
				<StatusIcon
					aria-hidden='true'
					className={cn('size-3.5', presentation.iconClassName)}
				/>
				<span className='min-w-0 flex-1 truncate font-medium text-[0.8125rem]'>
					{statusLabel}
				</span>
				<span className='shrink-0 rounded-full bg-foreground/5 px-1.5 py-0.5 text-muted-foreground text-xxs tabular-nums'>
					{isFiltered
						? t(
								'workbench:dashboard.column.count-filtered',
								'{{shown}}/{{total}}',
								{
									shown: cards.length,
									total: totalCount,
								},
							)
						: cards.length}
				</span>
			</div>
			{status === 'backlog' ? (
				<BacklogIssuesError failures={issuesErrors} />
			) : null}
			<ScrollArea className='min-h-0 flex-1'>
				{cards.length === 0 ? (
					<BoardColumnPlaceholder
						isFiltered={isFiltered}
						isLoading={status === 'backlog' && isLoadingIssues}
					/>
				) : null}
				<ul className='flex list-none flex-col gap-2 px-2 pt-1 pb-2 empty:hidden'>
					{cards.map((card) =>
						card.kind === 'workspace' ? (
							<li key={card.workspace.id}>
								<WorkspaceCard
									allowReorder={allowReorder}
									onOpen={() =>
										actions.onOpenWorkspace(card.project.id, card.workspace.id)
									}
									projectName={card.project.name}
									workspace={card.workspace}
								/>
							</li>
						) : (
							<li key={card.issue.key}>
								<IssueCard
									allowReorder={allowReorder}
									isDismissed={status === 'canceled'}
									issue={card.issue}
									onAssign={() =>
										actions.onAssignIssue(
											card.issue,
											status === 'backlog' || status === 'canceled'
												? 'in-progress'
												: status,
										)
									}
									onDismiss={() => actions.onDismissIssue(card.issue.key)}
									onRestore={() => actions.onRestoreIssue(card.issue.key)}
								/>
							</li>
						),
					)}
				</ul>
			</ScrollArea>
		</section>
	);
}

/** How many skeleton cards a loading column shows before its real ones arrive. */
const LOADING_SKELETON_COUNT = 3;

/**
 * Stands in for a column's card list when it has none. A column still loading
 * shows skeletons in the card silhouette, so waiting and empty never look the
 * same; an empty one says whether the toolbar's filter is what emptied it,
 * because that is the only version the user can undo.
 */
function BoardColumnPlaceholder({
	isFiltered,
	isLoading,
}: {
	isFiltered: boolean;
	isLoading: boolean;
}) {
	const { t } = useTranslation();
	if (isLoading) {
		return (
			<div
				aria-label={t('workbench:dashboard.column.loading', 'Loading issues…')}
				className='flex flex-col gap-2 px-2 pt-1 pb-2'
				aria-busy='true'
				role='status'
			>
				{SKELETON_ROWS.map((row) => (
					<BoardCardSkeleton key={row} />
				))}
			</div>
		);
	}
	return (
		<p className='px-3 py-6 text-center text-muted-foreground text-xxs'>
			{isFiltered
				? t(
						'workbench:dashboard.column.empty-filtered',
						'No cards match the filter',
					)
				: t('workbench:dashboard.column.empty', 'Nothing here yet')}
		</p>
	);
}

/** Stable keys for the skeleton rows, which have no data of their own to key on. */
const SKELETON_ROWS = Array.from(
	{ length: LOADING_SKELETON_COUNT },
	(_unused, index) => `board-card-skeleton-${index}`,
);

/** One placeholder card matching the real card's border, padding, and line rhythm. */
function BoardCardSkeleton() {
	return (
		<div className='flex flex-col gap-2 rounded-xl border border-foreground/10 px-3 py-2.5'>
			<Skeleton className='h-3 w-20' />
			<Skeleton className='h-3.5 w-full' />
			<Skeleton className='h-3 w-16' />
		</div>
	);
}
