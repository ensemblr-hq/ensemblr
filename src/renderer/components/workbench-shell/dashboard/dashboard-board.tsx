import { Navigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

import { SidebarInset, SidebarTrigger } from '@/renderer/components/ui/sidebar';
import { WorkbenchPlaceholderPage } from '@/renderer/components/workbench-shell/route-layout';
import {
	useSetupDiagnostics,
	useWorkbenchLayoutRouteModel,
} from '@/renderer/components/workbench-shell/shell-contexts';
import { SHELL_INSET_CLASS } from '@/renderer/components/workbench-shell/shell-inset';
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
import {
	BoardWorkspaceMenuProvider,
	useBoardWorkspaceMenu,
} from './board-workspace-menu';
import { planBoardDrop } from './plan-board-drop';
import { type BoardDrop, useBoardDragMonitor } from './use-board-drag';

/** Flattens the display projects into board cards, skipping optimistic rows. */
function toBoardCards(projects: ProjectShellModel[]): BoardCard[] {
	const cards: BoardCard[] = [];
	for (const project of projects) {
		for (const workspace of project.workspaces) {
			if (workspace.isPendingCreation === true) {
				continue;
			}
			cards.push({ project, workspace });
		}
	}
	return cards;
}

/** True when no project holds any workspace, optimistic rows included. */
function hasNoWorkspaces(projects: ProjectShellModel[]): boolean {
	return projects.every((project) => project.workspaces.length === 0);
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
 * persisted. Shows the setup placeholder while setup is blocked, and redirects
 * to the welcome screen once no workspaces remain.
 */
export function DashboardBoard() {
	const model = useWorkbenchLayoutRouteModel();
	const { state: setupDiagnosticsState } = useSetupDiagnostics();
	const statusByWorkspaceId = useWorkspaceBoardStatuses();
	const order = useWorkspaceBoardOrder();
	const { reorderBoard, setWorkspaceBoardStatus } = useWorkspaceBoardActions();

	const handleDrop = useCallback(
		(drop: BoardDrop) => {
			const plan = planBoardDrop(drop, statusByWorkspaceId);
			if (!plan) {
				return;
			}
			setWorkspaceBoardStatus(plan.sourceId, plan.targetStatus);
			reorderBoard({
				placeAfter: plan.placeAfter,
				sourceId: plan.sourceId,
				statusByWorkspaceId,
				targetCardId: plan.targetCardId,
				targetStatus: plan.targetStatus,
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
	const { controller: workspaceMenu, dialogs: workspaceMenuDialogs } =
		useBoardWorkspaceMenu();

	const setupStatus = setupDiagnosticsState.setupDiagnostics?.status;
	if (setupStatus === 'blocked') {
		return <WorkbenchPlaceholderPage view='dashboard' />;
	}
	if (hasNoWorkspaces(model.displayProjects)) {
		return <Navigate replace to='/' />;
	}

	return (
		<SidebarInset className={SHELL_INSET_CLASS}>
			<main className='flex min-w-0 flex-1 flex-col overflow-hidden'>
				<header className='native-toolbar flex h-12 shrink-0 items-center gap-2.5 border-border border-b px-4 font-medium text-sm'>
					<SidebarTrigger className='sidebar-collapsed-trigger' />
					<span>Dashboard</span>
				</header>
				<BoardWorkspaceMenuProvider controller={workspaceMenu}>
					<div className='min-h-0 flex-1 overflow-x-auto p-4'>
						<div className='mx-auto flex h-full w-max gap-3'>
							{BOARD_STATUS_ORDER.map((status) => (
								<BoardColumn
									cards={grouped[status]}
									key={status}
									onOpenWorkspace={model.navigateToWorkspace}
									status={status}
								/>
							))}
						</div>
					</div>
				</BoardWorkspaceMenuProvider>
				{workspaceMenuDialogs}
			</main>
		</SidebarInset>
	);
}
