import { useCallback, useMemo } from 'react';

import { WorkbenchEmptyStateContent } from '@/renderer/components/workbench-empty-state';
import { WorkbenchPlaceholderPage } from '@/renderer/components/workbench-shell/route-layout';
import {
	useSetupDiagnostics,
	useWorkbenchLayoutRouteModel,
} from '@/renderer/components/workbench-shell/shell-contexts';
import {
	BOARD_STATUS_ORDER,
	orderColumnWorkspaceIds,
	resolveBoardStatus,
	useWorkspaceBoardActions,
	useWorkspaceBoardOrder,
	useWorkspaceBoardStatuses,
	type WorkspaceBoardStatus,
} from '@/renderer/state/workspace';
import type { ProjectShellModel } from '@/renderer/types/workbench';

import { type BoardCard, BoardColumn } from './board-column';
import { type BoardDrop, useBoardDragMonitor } from './use-board-drag';

/** Flattens the display projects into board cards, skipping optimistic rows. */
function toBoardCards(projects: ProjectShellModel[]): BoardCard[] {
	return projects.flatMap((project) =>
		project.workspaces
			.filter((workspace) => workspace.isPendingCreation !== true)
			.map((workspace) => ({ project, workspace })),
	);
}

/** Buckets board cards into one list per status, ordered by the board order. */
function groupCardsByStatus(
	cards: BoardCard[],
	statusByWorkspaceId: Record<string, WorkspaceBoardStatus>,
	order: string[],
): Record<WorkspaceBoardStatus, BoardCard[]> {
	const cardByWorkspaceId = new Map(
		cards.map((card) => [card.workspace.id, card]),
	);
	const idsByStatus = Object.fromEntries(
		BOARD_STATUS_ORDER.map((status) => [status, [] as string[]]),
	) as Record<WorkspaceBoardStatus, string[]>;
	for (const card of cards) {
		const status = resolveBoardStatus(statusByWorkspaceId, card.workspace.id);
		idsByStatus[status].push(card.workspace.id);
	}
	return Object.fromEntries(
		BOARD_STATUS_ORDER.map((status) => [
			status,
			orderColumnWorkspaceIds(order, idsByStatus[status]).flatMap((id) => {
				const card = cardByWorkspaceId.get(id);
				return card ? [card] : [];
			}),
		]),
	) as Record<WorkspaceBoardStatus, BoardCard[]>;
}

/**
 * Dashboard Kanban board: every workspace across all projects as a card in its
 * board-status column, with drag-to-reassign and in-column reordering both
 * persisted. Falls back to the setup/empty placeholder when there is nothing to
 * show.
 */
export function DashboardBoard() {
	const model = useWorkbenchLayoutRouteModel();
	const { state: setupDiagnosticsState } = useSetupDiagnostics();
	const statusByWorkspaceId = useWorkspaceBoardStatuses();
	const order = useWorkspaceBoardOrder();
	const { reorderBoard, setWorkspaceBoardStatus } = useWorkspaceBoardActions();

	const handleDrop = useCallback(
		(drop: BoardDrop) => {
			const targetStatus = drop.targetCardId
				? resolveBoardStatus(statusByWorkspaceId, drop.targetCardId)
				: drop.targetColumnStatus;
			if (!targetStatus) {
				return;
			}
			const droppedOnColumnWhitespace = !drop.targetCardId;
			const sourceStatus = resolveBoardStatus(
				statusByWorkspaceId,
				drop.sourceId,
			);
			if (droppedOnColumnWhitespace && sourceStatus === targetStatus) {
				return;
			}
			setWorkspaceBoardStatus(drop.sourceId, targetStatus);
			reorderBoard({
				placeAfter: drop.edge === 'bottom',
				sourceId: drop.sourceId,
				statusByWorkspaceId,
				targetCardId: drop.targetCardId,
				targetStatus,
			});
		},
		[reorderBoard, setWorkspaceBoardStatus, statusByWorkspaceId],
	);
	useBoardDragMonitor(handleDrop);

	const cards = useMemo(
		() => toBoardCards(model.displayProjects),
		[model.displayProjects],
	);
	const grouped = useMemo(
		() => groupCardsByStatus(cards, statusByWorkspaceId, order),
		[cards, statusByWorkspaceId, order],
	);

	const setupStatus = setupDiagnosticsState.setupDiagnostics?.status;
	if (setupStatus !== 'ready') {
		return <WorkbenchPlaceholderPage view='dashboard' />;
	}
	if (cards.length === 0) {
		return (
			<WorkbenchEmptyStateContent
				emptyState={{
					detail: 'Create a workspace to see it on the board.',
					title: 'Dashboard',
				}}
			/>
		);
	}

	return (
		<main className='flex min-w-0 flex-1 flex-col overflow-hidden'>
			<header className='native-toolbar flex h-12 shrink-0 items-center border-border border-b px-4 font-medium text-sm'>
				Dashboard
			</header>
			<div className='flex min-h-0 flex-1 gap-3 overflow-x-auto p-4'>
				{BOARD_STATUS_ORDER.map((status) => (
					<BoardColumn
						cards={grouped[status]}
						key={status}
						onOpenWorkspace={model.navigateToWorkspace}
						status={status}
					/>
				))}
			</div>
		</main>
	);
}
