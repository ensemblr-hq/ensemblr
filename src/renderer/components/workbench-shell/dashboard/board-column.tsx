import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { useEffect, useRef, useState } from 'react';

import { BOARD_STATUS_PRESENTATION } from '@/renderer/components/workbench-shell/workspace-status/board-status-presentation';
import { cn } from '@/renderer/lib/utils';
import type { WorkspaceBoardStatus } from '@/renderer/state/workspace';
import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import { WorkspaceCard } from './workspace-card';

/** A workspace paired with the project it belongs to, for board rendering. */
export interface BoardCard {
	project: ProjectShellModel;
	workspace: WorkspaceShellModel;
}

/**
 * A single dashboard board column for one board status. Acts as a drop target
 * for workspace cards; dropping a card here reassigns it to this column's status.
 */
export function BoardColumn({
	cards,
	onOpenWorkspace,
	status,
}: {
	cards: BoardCard[];
	onOpenWorkspace: (projectId: string, workspaceId: string) => void;
	status: WorkspaceBoardStatus;
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [isDraggedOver, setIsDraggedOver] = useState(false);
	const presentation = BOARD_STATUS_PRESENTATION[status];
	const StatusIcon = presentation.icon;

	useEffect(() => {
		const element = ref.current;
		if (!element) {
			return undefined;
		}
		return dropTargetForElements({
			element,
			canDrop: ({ source }) => source.data.type === 'workspace-card',
			getData: () => ({ type: 'board-column', status }),
			onDragEnter: () => setIsDraggedOver(true),
			onDragLeave: () => setIsDraggedOver(false),
			onDrop: () => setIsDraggedOver(false),
		});
	}, [status]);

	return (
		<section
			aria-label={`${presentation.label} column, ${cards.length} ${cards.length === 1 ? 'workspace' : 'workspaces'}`}
			className={cn(
				'flex w-72 shrink-0 flex-col rounded-xl bg-muted/40 transition-colors',
				isDraggedOver && 'bg-muted',
			)}
			ref={ref}
		>
			<div className='flex items-center gap-2 px-3 py-2.5'>
				<StatusIcon
					aria-hidden='true'
					className={cn('size-3.5', presentation.iconClassName)}
				/>
				<span className='min-w-0 flex-1 truncate font-medium text-[0.8125rem]'>
					{presentation.label}
				</span>
				<span className='text-muted-foreground text-xxs tabular-nums'>
					{cards.length}
				</span>
			</div>
			<ul className='flex min-h-0 flex-1 list-none flex-col gap-2 overflow-y-auto px-2 pt-1 pb-2'>
				{cards.map(({ project, workspace }) => (
					<li key={workspace.id}>
						<WorkspaceCard
							onOpen={() => onOpenWorkspace(project.id, workspace.id)}
							projectName={project.name}
							workspace={workspace}
						/>
					</li>
				))}
			</ul>
		</section>
	);
}
