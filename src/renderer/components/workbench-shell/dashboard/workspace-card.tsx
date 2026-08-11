import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import {
	draggable,
	dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import {
	attachClosestEdge,
	type Edge,
	extractClosestEdge,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import type { TFunction } from 'i18next';
import { GitBranchIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/renderer/components/ui/badge';
import { Card } from '@/renderer/components/ui/card';
import {
	ContextMenu,
	ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import { WorkspaceContextMenuContent } from '@/renderer/components/workbench-shell/workspace-sidebar-item/context-menu';
import { WorkspaceDiffStats } from '@/renderer/components/workbench-shell/workspace-sidebar-item/diff-stats';
import { useWorkspaceBusy } from '@/renderer/hooks/workspace/use-workspace-busy';
import { cn } from '@/renderer/lib/utils';
import { getWorkspaceSidebarState } from '@/renderer/lib/workbench';
import { useWorkspaceIsUnread } from '@/renderer/state/workspace';
import type { WorkspaceSidebarStateKind } from '@/renderer/types/components';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import { useBoardWorkspaceMenuController } from './board-workspace-menu';

/** Wires a card element as both a drag source and an edge-aware drop target. */
function useCardDnd(workspaceId: string) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [isDragging, setIsDragging] = useState(false);
	const [closestEdge, setClosestEdge] = useState<Edge | null>(null);

	useEffect(() => {
		const element = ref.current;
		if (!element) {
			return undefined;
		}
		return combine(
			draggable({
				element,
				getInitialData: () => ({ type: 'workspace-card', workspaceId }),
				onDragStart: () => setIsDragging(true),
				onDrop: () => setIsDragging(false),
			}),
			dropTargetForElements({
				canDrop: ({ source }) =>
					source.data.type === 'workspace-card' &&
					source.data.workspaceId !== workspaceId,
				element,
				getData: ({ element: target, input }) =>
					attachClosestEdge(
						{ type: 'workspace-card', workspaceId },
						{ allowedEdges: ['top', 'bottom'], element: target, input },
					),
				getIsSticky: () => true,
				onDrag: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
				onDragLeave: () => setClosestEdge(null),
				onDrop: () => setClosestEdge(null),
			}),
		);
	}, [workspaceId]);

	return { closestEdge, isDragging, ref };
}

/**
 * Draggable board card for a single workspace. Dragging it to another column
 * changes the workspace's board status; dragging within a column reorders it;
 * clicking opens the workspace; right-clicking opens the same workspace context
 * menu the sidebar uses (minus the sidebar-only pin action). The label renders
 * bold while the workspace is unread, mirroring the sidebar.
 */
export function WorkspaceCard({
	onOpen,
	projectName,
	workspace,
}: {
	onOpen: () => void;
	projectName: string;
	workspace: WorkspaceShellModel;
}) {
	const { t } = useTranslation();
	const menu = useBoardWorkspaceMenuController();
	const isUnread = useWorkspaceIsUnread(workspace.id);
	const hasDiffStats =
		workspace.changeSummary.additions > 0 ||
		workspace.changeSummary.deletions > 0;
	const { closestEdge, isDragging, ref } = useCardDnd(workspace.id);

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					className={cn(
						'relative cursor-grab transition-opacity',
						isDragging && 'opacity-50',
					)}
					ref={ref}
				>
					<BoardDropIndicator edge={closestEdge} />
					<Card className='gap-0 border border-foreground/10 py-0 ring-0 hover:border-foreground/20'>
						<button
							aria-label={t(
								'workbench:workspace-item.open-aria',
								'Open workspace {{workspace}}',
								{ workspace: workspace.name },
							)}
							className='flex w-full flex-col gap-2 px-3 py-2.5 text-left'
							onClick={onOpen}
							type='button'
						>
							<div className='flex min-w-0 items-center justify-between gap-2'>
								<span
									className={cn(
										'min-w-0 flex-1 truncate text-[0.8125rem]',
										isUnread ? 'font-semibold' : 'font-medium',
									)}
								>
									{workspace.name}
								</span>
								{hasDiffStats ? (
									<WorkspaceDiffStats workspace={workspace} />
								) : null}
							</div>
							<span className='truncate text-muted-foreground text-xxs'>
								{projectName}
							</span>
							<div className='flex min-w-0 items-center gap-1.5 text-muted-foreground text-xxs'>
								<GitBranchIcon aria-hidden='true' className='size-3 shrink-0' />
								<span className='truncate'>{workspace.branchName}</span>
							</div>
							<WorkspaceCardFooter workspace={workspace} />
						</button>
					</Card>
				</div>
			</ContextMenuTrigger>
			<WorkspaceContextMenuContent
				onArchiveSelect={() => menu.openArchive(workspace)}
				onDeleteSelect={() => menu.openDelete(workspace)}
				onRenameSelect={() => menu.openRename(workspace)}
				workspace={workspace}
			/>
		</ContextMenu>
	);
}

/** Thin insertion line shown at the card's top or bottom edge while dragging over it. */
function BoardDropIndicator({ edge }: { edge: Edge | null }) {
	if (edge !== 'top' && edge !== 'bottom') {
		return null;
	}
	return (
		<div
			aria-hidden='true'
			className={cn(
				'pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-primary',
				edge === 'top' ? '-top-1' : '-bottom-1',
			)}
		/>
	);
}

/** PR-status footer for a board card; collapses when empty. */
function WorkspaceCardFooter({
	workspace,
}: {
	workspace: WorkspaceShellModel;
}) {
	const hasPr = workspace.pullRequest.number !== undefined;
	return (
		<div className='flex flex-wrap items-center gap-1.5 empty:hidden'>
			{hasPr ? <WorkspacePrBadge workspace={workspace} /> : null}
		</div>
	);
}

/**
 * Sentence fragment naming a workspace's live state inside the card's aria
 * label. Keyed off the state id so translators receive a phrase per state
 * rather than an enum member reworded into English.
 * @param t - Translation function from `useTranslation`
 * @param kind - Sidebar state the badge is tinted by
 * @returns The state fragment in the active language
 */
function workspaceStateLabel(
	t: TFunction,
	kind: WorkspaceSidebarStateKind,
): string {
	switch (kind) {
		case 'branch':
			return t('workbench:dashboard.card.state.branch', 'branch');
		case 'pr-blocked':
			return t('workbench:dashboard.card.state.pr-blocked', 'blocked');
		case 'pr-checking':
			return t('workbench:dashboard.card.state.pr-checking', 'checks running');
		case 'pr-merged':
			return t('workbench:dashboard.card.state.pr-merged', 'merged');
		case 'pr-open':
			return t('workbench:dashboard.card.state.pr-open', 'open');
		case 'pr-ready':
			return t('workbench:dashboard.card.state.pr-ready', 'ready to merge');
		case 'pr-working':
			return t('workbench:dashboard.card.state.pr-working', 'agent working');
		case 'workspace-blocked':
			return t(
				'workbench:dashboard.card.state.workspace-blocked',
				'workspace blocked',
			);
		case 'workspace-checking':
			return t(
				'workbench:dashboard.card.state.workspace-checking',
				'workspace checks running',
			);
		default:
			return t(
				'workbench:dashboard.card.state.workspace-working',
				'agent working',
			);
	}
}

/** Badge showing a workspace's PR number tinted by its live PR/agent status. */
function WorkspacePrBadge({ workspace }: { workspace: WorkspaceShellModel }) {
	const { t } = useTranslation();
	const agentBusy = useWorkspaceBusy(workspace.id);
	const state = getWorkspaceSidebarState(workspace, { agentBusy });
	const StateIcon = state.icon;
	return (
		<Badge
			aria-label={t(
				'workbench:dashboard.card.pull-request-aria',
				'Pull request #{{number}} {{state}}',
				{
					number: workspace.pullRequest.number,
					state: workspaceStateLabel(t, state.kind),
				},
			)}
			className='gap-1'
			variant='outline'
		>
			<StateIcon
				aria-hidden='true'
				className={cn(state.className, state.isSpinning && 'animate-spin')}
			/>
			#{workspace.pullRequest.number}
		</Badge>
	);
}
