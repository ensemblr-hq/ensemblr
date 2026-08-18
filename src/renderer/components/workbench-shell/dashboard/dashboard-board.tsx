import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { refreshBoardIssues } from '@/renderer/api/ensemblr';
import { SidebarTrigger } from '@/renderer/components/ui/sidebar';
import { WorkbenchPlaceholderPage } from '@/renderer/components/workbench-shell/route-layout';
import {
	useSetupDiagnostics,
	useWorkbenchLayoutRouteModel,
} from '@/renderer/components/workbench-shell/shell-contexts';
import { ShellScreen } from '@/renderer/components/workbench-shell/shell-screen';
import { useBoardDragMonitor } from '@/renderer/hooks/workbench-shell/dashboard/use-board-drag';
import { useBoardIssues } from '@/renderer/hooks/workbench-shell/dashboard/use-board-issues';
import { filterBoardCards } from '@/renderer/lib/workbench/filter-board-cards';
import { groupBoardCards } from '@/renderer/lib/workbench/group-board-cards';
import { planBoardDrop } from '@/renderer/lib/workbench/plan-board-drop';
import {
	BOARD_STATUS_ORDER,
	useBoardFilters,
	useBoardIssueDismissals,
	useWorkspaceBoardActions,
	useWorkspaceBoardOrder,
	useWorkspaceBoardStatuses,
	type WorkspaceBoardStatus,
} from '@/renderer/state/workspace';
import type {
	BoardDrop,
	BoardIssueCard,
} from '@/renderer/types/workbench-shell';

import {
	AssignIssueDialog,
	type AssignIssueRequest,
} from './assign-issue-dialog';
import { BoardColumn, type BoardColumnActions } from './board-column';
import { BoardToolbar } from './board-toolbar';
import {
	BoardWorkspaceMenuProvider,
	useBoardWorkspaceMenu,
} from './board-workspace-menu';

/**
 * Dashboard Kanban board. Backlog holds the work that has no workspace yet —
 * unstarted Linear issues and unassigned open GitHub issues — and every other
 * column holds workspaces, with drag-to-reassign and in-column reordering both
 * persisted. Dragging an issue rightward is how a workspace gets created from
 * it; nothing is ever written back to Linear or GitHub.
 */
export function DashboardBoard() {
	const { t } = useTranslation();
	const model = useWorkbenchLayoutRouteModel();
	const { state: setupDiagnosticsState } = useSetupDiagnostics();
	const statusByWorkspaceId = useWorkspaceBoardStatuses();
	const order = useWorkspaceBoardOrder();
	const { reorderBoard, setWorkspaceBoardStatus } = useWorkspaceBoardActions();
	const { dismiss, dismissedKeys, restore } = useBoardIssueDismissals();
	const boardFilters = useBoardFilters();
	const { backlogIssues, dismissedIssues, errors, isLoading } = useBoardIssues(
		model.displayProjects,
	);
	const [assignRequest, setAssignRequest] = useState<AssignIssueRequest | null>(
		null,
	);
	const queryClient = useQueryClient();
	const [isRefreshing, setIsRefreshing] = useState(false);

	const handleRefresh = useCallback(() => {
		setIsRefreshing(true);
		void refreshBoardIssues(
			queryClient,
			model.displayProjects.map((project) => project.id),
		).finally(() => setIsRefreshing(false));
	}, [model.displayProjects, queryClient]);

	const openAssignDialog = useCallback(
		(issue: BoardIssueCard, targetStatus: WorkspaceBoardStatus) =>
			setAssignRequest({ issue, targetStatus }),
		[],
	);
	const issuesByKey = useMemo(
		() =>
			new Map(
				[...backlogIssues, ...dismissedIssues].map((issue) => [
					issue.key,
					issue,
				]),
			),
		[backlogIssues, dismissedIssues],
	);

	const sort = boardFilters.filters.sort;
	const allowReorder = sort === 'manual';

	const handleDrop = useCallback(
		(drop: BoardDrop) => {
			const plan = planBoardDrop(drop, statusByWorkspaceId, sort);
			if (!plan) {
				return;
			}
			if (plan.kind === 'dismiss-issue') {
				dismiss(plan.issueKey);
				return;
			}
			if (plan.kind === 'restore-issue') {
				restore(plan.issueKey);
				return;
			}
			if (plan.kind === 'assign-issue') {
				const issue = issuesByKey.get(plan.issueKey);
				if (issue) {
					openAssignDialog(issue, plan.targetStatus);
				}
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
		[
			dismiss,
			issuesByKey,
			openAssignDialog,
			reorderBoard,
			restore,
			setWorkspaceBoardStatus,
			sort,
			statusByWorkspaceId,
		],
	);
	useBoardDragMonitor(handleDrop);

	const grouped = useMemo(
		() =>
			groupBoardCards({
				backlogIssues,
				dismissedIssues,
				order,
				projects: model.displayProjects,
				statusByWorkspaceId,
			}),
		[
			backlogIssues,
			dismissedIssues,
			model.displayProjects,
			order,
			statusByWorkspaceId,
		],
	);
	const columns = useMemo(
		() =>
			BOARD_STATUS_ORDER.map((status) => ({
				cards: filterBoardCards(grouped[status], boardFilters.filters),
				status,
				totalCount: grouped[status].length,
			})),
		[boardFilters.filters, grouped],
	);
	const columnActions = useMemo<BoardColumnActions>(
		() => ({
			onAssignIssue: openAssignDialog,
			onDismissIssue: dismiss,
			onOpenWorkspace: model.navigateToWorkspace,
			onRestoreIssue: restore,
		}),
		[dismiss, model.navigateToWorkspace, openAssignDialog, restore],
	);
	const { controller: workspaceMenu, dialogs: workspaceMenuDialogs } =
		useBoardWorkspaceMenu();

	const setupStatus = setupDiagnosticsState.setupDiagnostics?.status;
	if (setupStatus === 'blocked') {
		return <WorkbenchPlaceholderPage view='dashboard' />;
	}
	return (
		<ShellScreen>
			<header className='native-toolbar flex h-12 shrink-0 items-center gap-2.5 overflow-hidden border-border border-b px-4 font-medium text-sm'>
				<SidebarTrigger className='sidebar-collapsed-trigger' />
				<span className='shrink-0'>
					{t('workbench:dashboard.title', 'Dashboard')}
				</span>
				<BoardToolbar
					filters={boardFilters}
					isRefreshing={isRefreshing}
					onRefresh={handleRefresh}
					projects={model.displayProjects}
				/>
			</header>
			<BoardWorkspaceMenuProvider controller={workspaceMenu}>
				<div className='min-h-0 flex-1 overflow-x-auto p-4'>
					<div className='mx-auto flex h-full w-max gap-3'>
						{columns.map((column) => (
							<BoardColumn
								actions={columnActions}
								allowReorder={allowReorder}
								cards={column.cards}
								isLoadingIssues={isLoading}
								issuesErrors={errors}
								key={column.status}
								status={column.status}
								totalCount={column.totalCount}
							/>
						))}
					</div>
				</div>
			</BoardWorkspaceMenuProvider>
			{workspaceMenuDialogs}
			<AssignIssueDialog
				onAssigned={setWorkspaceBoardStatus}
				onOpenWorkspace={model.navigateToWorkspace}
				onOpenChange={(open) => {
					if (!open) {
						setAssignRequest(null);
					}
				}}
				projects={model.displayProjects}
				request={assignRequest}
			/>
		</ShellScreen>
	);
}
