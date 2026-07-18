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
import { GitBranchIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/renderer/components/ui/badge';
import { Card } from '@/renderer/components/ui/card';
import { WorkspaceDiffStats } from '@/renderer/components/workbench-shell/workspace-sidebar-item/diff-stats';
import { useWorkspacePiBusy } from '@/renderer/hooks/workspace/use-workspace-pi-busy';
import { cn } from '@/renderer/lib/utils';
import { getWorkspaceSidebarState } from '@/renderer/lib/workbench';
import { useWorkspaceUnread } from '@/renderer/state/workspace';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

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
 * clicking opens the workspace. The label renders bold while the workspace is
 * unread, mirroring the sidebar.
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
	const isUnread = useWorkspaceUnread(workspace.id);
	const { closestEdge, isDragging, ref } = useCardDnd(workspace.id);

	return (
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
					aria-label={`Open workspace ${workspace.name}`}
					className='flex w-full flex-col gap-2 px-3 py-2.5 text-left'
					onClick={onOpen}
					type='button'
				>
					<span
						className={cn(
							'truncate text-[0.8125rem]',
							isUnread ? 'font-semibold' : 'font-medium',
						)}
					>
						{workspace.name}
					</span>
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

/** PR-status + diff-stats footer for a board card; collapses when empty. */
function WorkspaceCardFooter({
	workspace,
}: {
	workspace: WorkspaceShellModel;
}) {
	const { additions, deletions } = workspace.changeSummary;
	const hasPr = workspace.pullRequest.number !== undefined;
	const hasDiff = additions + deletions > 0;
	return (
		<div className='flex flex-wrap items-center gap-1.5 empty:hidden'>
			{hasPr ? <WorkspacePrBadge workspace={workspace} /> : null}
			{hasDiff ? <WorkspaceDiffStats isActive workspace={workspace} /> : null}
		</div>
	);
}

/** Badge showing a workspace's PR number tinted by its live PR/agent status. */
function WorkspacePrBadge({ workspace }: { workspace: WorkspaceShellModel }) {
	const agentBusy = useWorkspacePiBusy(workspace.id);
	const state = getWorkspaceSidebarState(workspace, { agentBusy });
	const StateIcon = state.icon;
	const stateLabel = state.kind.replace(/^pr-/, '').replace(/-/g, ' ');
	return (
		<Badge
			aria-label={`Pull request #${workspace.pullRequest.number} ${stateLabel}`}
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
