import { Link } from '@tanstack/react-router';
import { PlusIcon, Undo2Icon, XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { LinearStateBadge } from '@/renderer/components/linear/issue-state-badge';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Card } from '@/renderer/components/ui/card';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuGroup,
	ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import { SidebarContextMenuItem } from '@/renderer/components/workbench-shell/sidebar-context-menu-item';
import {
	GithubLogo,
	LinearLogo,
} from '@/renderer/components/workbench-shell/source-provider-logo';
import { cn } from '@/renderer/lib/utils';
import type { BoardIssueCard } from '@/renderer/types/workbench-shell';

import { BoardDropIndicator } from './board-drop-indicator';
import { useCardDnd } from './use-card-dnd';

/** Labels beyond this count collapse into a `+n` chip so the card keeps its height. */
const MAX_VISIBLE_LABELS = 3;

/**
 * Draggable Backlog card for an issue that has no workspace yet. Dragging it
 * into a working column opens the assign dialog; dragging it onto Canceled
 * dismisses it. Clicking a Linear issue opens the built-in viewer; a GitHub
 * issue opens in the browser, since Ensemblr has no GitHub issue screen.
 *
 * Keeps its grab cursor under every sort: a non-manual sort only takes away
 * in-column reordering, and the card still drags between columns. The corner
 * button reaches the same "create workspace" the drag does, so the card's
 * primary action is not locked behind a pointer gesture.
 */
export function IssueCard({
	allowReorder,
	isDismissed,
	issue,
	onAssign,
	onDismiss,
	onRestore,
}: {
	allowReorder: boolean;
	isDismissed: boolean;
	issue: BoardIssueCard;
	onAssign: () => void;
	onDismiss: () => void;
	onRestore: () => void;
}) {
	const { t } = useTranslation();
	const { closestEdge, isDragging, ref } = useCardDnd(
		issue.key,
		'issue',
		allowReorder,
	);

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					className={cn(
						'group/issue-card relative cursor-grab transition-opacity active:cursor-grabbing',
						isDragging && 'opacity-50',
						isDismissed && 'opacity-60',
					)}
					ref={ref}
				>
					<BoardDropIndicator edge={closestEdge} />
					<Card className='gap-0 overflow-hidden border border-foreground/10 py-0 ring-0 transition-colors hover:border-foreground/20'>
						<IssueCardLink issue={issue}>
							<div className='flex min-w-0 items-center gap-1.5 pr-6'>
								{issue.provider === 'linear' ? (
									<LinearLogo className='size-3.5 shrink-0 text-muted-foreground' />
								) : (
									<GithubLogo className='size-3.5 shrink-0 text-muted-foreground' />
								)}
								<span className='truncate font-mono text-muted-foreground text-xxs'>
									{issue.reference}
								</span>
							</div>
							<span className='line-clamp-2 min-w-0 font-medium text-[0.8125rem]'>
								{issue.title}
							</span>
							{issue.subtitle ? (
								<span className='truncate text-muted-foreground text-xxs'>
									{issue.subtitle}
								</span>
							) : null}
							<IssueCardMeta issue={issue} />
						</IssueCardLink>
					</Card>
					<Button
						aria-label={t(
							'workbench:dashboard.issue-card.create-workspace-aria',
							'Create a workspace from issue {{issue}}',
							{ issue: issue.reference },
						)}
						className='absolute top-1.5 right-1.5 size-6 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/issue-card:opacity-100'
						onClick={onAssign}
						size='icon-xs'
						type='button'
						variant='ghost'
					>
						<PlusIcon aria-hidden='true' />
					</Button>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent
				aria-label={t(
					'workbench:dashboard.issue-card.menu-aria',
					'{{issue}} issue actions',
					{ issue: issue.reference },
				)}
				className='w-56 bg-muted p-1'
			>
				<ContextMenuGroup>
					<SidebarContextMenuItem onSelect={onAssign}>
						<PlusIcon aria-hidden='true' />
						<span className='min-w-0 flex-1'>
							{t(
								'workbench:dashboard.issue-card.create-workspace',
								'Create workspace…',
							)}
						</span>
					</SidebarContextMenuItem>
					{isDismissed ? (
						<SidebarContextMenuItem onSelect={onRestore}>
							<Undo2Icon aria-hidden='true' />
							<span className='min-w-0 flex-1'>
								{t(
									'workbench:dashboard.issue-card.restore',
									'Move back to Backlog',
								)}
							</span>
						</SidebarContextMenuItem>
					) : (
						<SidebarContextMenuItem onSelect={onDismiss}>
							<XIcon aria-hidden='true' />
							<span className='min-w-0 flex-1'>
								{t(
									'workbench:dashboard.issue-card.dismiss',
									'Dismiss from board',
								)}
							</span>
						</SidebarContextMenuItem>
					)}
				</ContextMenuGroup>
			</ContextMenuContent>
		</ContextMenu>
	);
}

/**
 * Wraps the card body in the right kind of link for the issue's provider:
 * a router link into the built-in Linear viewer, or a plain external anchor for
 * GitHub, which has no in-app screen.
 *
 * Both opt out of native dragging. An anchor is draggable by default, so the
 * browser makes *it* the `dragstart` target instead of the card wrapper
 * `useCardDnd` registered — pragmatic-drag-and-drop then finds no matching
 * draggable and drops the drag, leaving the card stuck in its column.
 */
function IssueCardLink({
	children,
	issue,
}: {
	children: ReactNode;
	issue: BoardIssueCard;
}) {
	const { t } = useTranslation();
	const className =
		'flex w-full flex-col gap-2 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50';
	const ariaLabel = t(
		'workbench:dashboard.issue-card.open-aria',
		'Open issue {{issue}}',
		{ issue: issue.reference },
	);

	if (issue.provider === 'linear') {
		return (
			<Link
				aria-label={ariaLabel}
				className={className}
				draggable={false}
				params={{ issueId: issue.key }}
				to='/linear/$issueId'
			>
				{children}
			</Link>
		);
	}

	return (
		<a
			aria-label={ariaLabel}
			className={className}
			draggable={false}
			href={issue.url}
			rel='noreferrer'
			target='_blank'
		>
			{children}
		</a>
	);
}

/** Workflow-state badge for a Linear issue, or the label chips for a GitHub one. */
function IssueCardMeta({ issue }: { issue: BoardIssueCard }) {
	const { t } = useTranslation();
	const visibleLabels = issue.labels.slice(0, MAX_VISIBLE_LABELS);
	const overflowCount = issue.labels.length - visibleLabels.length;

	return (
		<div className='flex flex-wrap items-center gap-1.5 empty:hidden'>
			{issue.provider === 'linear' ? (
				<LinearStateBadge
					color={issue.stateColor}
					name={issue.stateName}
					stateType={issue.stateType}
				/>
			) : null}
			{visibleLabels.map((label) => (
				<Badge className='max-w-28 truncate' key={label} variant='outline'>
					{label}
				</Badge>
			))}
			{overflowCount > 0 ? (
				<Badge variant='outline'>
					{t('workbench:dashboard.issue-card.more-labels', '+{{overflow}}', {
						overflow: overflowCount,
					})}
				</Badge>
			) : null}
		</div>
	);
}
