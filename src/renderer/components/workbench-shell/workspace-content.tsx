import { useSetAtom } from 'jotai';
import { type ComponentType, useCallback, useRef } from 'react';
import { useAgentActionRunner } from '@/renderer/hooks/workbench-shell/review-actions/use-agent-action-runner';
import { useDockController } from '@/renderer/hooks/workbench-shell/use-dock-controller';
import { useRightSidebarController } from '@/renderer/hooks/workbench-shell/use-right-sidebar-controller';
import { useRouteProfilerMount } from '@/renderer/lib/instrumentation';
import { workspaceDirectoryRevealRequestAtom } from '@/renderer/state/workspace';
import type { WorkspaceMainContentState } from '@/renderer/types/components';
import type { PullRequestCommentSummary } from '@/renderer/types/workbench';
import type {
	SessionTabActions,
	SessionTabState,
	WorkbenchShellProps,
} from '@/renderer/types/workbench-shell';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';
import {
	CommentPreviewOpenerProvider,
	ReviewFilePreviewOpenerProvider,
	WorkspaceFileDiffOpenerProvider,
} from './conversation-panel/file-preview-context';
import { WorkbenchPanelLayout } from './panel-layout';
import { ReviewActionsProvider } from './review-actions/review-actions-provider';
import { WorkbenchLayoutProvider } from './shell-contexts';

/**
 * Active-workspace shell content — owns review/dock collapse state and
 * viewport syncing. Session-tab state is owned by the route shell (the single
 * `useSessionTabState` instance) and passed in via `sessionNavigation`.
 */
export function WorkspaceWorkbenchContent({
	activeProject,
	activeReviewTab,
	activeWorkspace,
	composer,
	dockActions,
	dockTabId,
	onDockTabChange,
	onReviewTabChange,
	onSessionTabChange,
	sessionNavigation,
	MainContent,
}: Pick<
	WorkbenchShellProps,
	| 'activeProject'
	| 'activeReviewTab'
	| 'activeWorkspace'
	| 'composer'
	| 'dockActions'
	| 'dockTabId'
	| 'onDockTabChange'
	| 'onReviewTabChange'
	| 'onSessionTabChange'
> & {
	MainContent: ComponentType<WorkspaceMainContentState>;
	sessionNavigation: SessionTabState & SessionTabActions;
}) {
	useRouteProfilerMount('WorkspaceWorkbenchContent');

	const rightSidebar = useRightSidebarController();
	const dock = useDockController();
	const setDirectoryRevealRequest = useSetAtom(
		workspaceDirectoryRevealRequestAtom,
	);
	const directoryRevealRequestIdRef = useRef(0);
	const {
		openWorkspaceFileDiffTab,
		openFilePreviewTab,
		openCommentPreviewTab,
	} = sessionNavigation;
	const openWorkspaceFileDiff = useCallback(
		(filePath: string, scope?: WorkspaceGitDiffScope) => {
			void openWorkspaceFileDiffTab({ filePath, scope }).then((result) => {
				if (result) {
					onSessionTabChange(result.chatTabId);
				}
			});
		},
		[onSessionTabChange, openWorkspaceFileDiffTab],
	);
	const openReviewFilePreview = useCallback(
		(filePath: string) => {
			void openFilePreviewTab({ filePath }).then((result) => {
				if (result) {
					onSessionTabChange(result.chatTabId);
				}
			});
		},
		[onSessionTabChange, openFilePreviewTab],
	);
	const openCommentPreview = useCallback(
		(input: { comment: PullRequestCommentSummary; prNumber?: number }) => {
			void openCommentPreviewTab(input).then((result) => {
				if (result) {
					onSessionTabChange(result.chatTabId);
				}
			});
		},
		[onSessionTabChange, openCommentPreviewTab],
	);
	const revealWorkspaceDirectory = useCallback(
		(directoryPath: string) => {
			directoryRevealRequestIdRef.current += 1;
			setDirectoryRevealRequest({
				id: directoryRevealRequestIdRef.current,
				path: directoryPath,
				workspaceId: activeWorkspace.id,
			});
			onReviewTabChange('files');
			void rightSidebar.expandRightSidebar();
		},
		[
			activeWorkspace.id,
			onReviewTabChange,
			rightSidebar.expandRightSidebar,
			setDirectoryRevealRequest,
		],
	);
	const runAgentAction = useAgentActionRunner({
		activeProject,
		activeSession: sessionNavigation.effectiveActiveSession,
		activeWorkspace,
		openSessionTab: sessionNavigation.openSessionTab,
		selectChat: onSessionTabChange,
		sessionTabs: sessionNavigation.sessionTabs,
	});
	const mainContentState = {
		activeSession: sessionNavigation.effectiveActiveSession,
		activeWorkspace,
		closedSessions: sessionNavigation.closedSessions,
		composer,
		onDirectoryReveal: revealWorkspaceDirectory,
		onFilePreviewOpen: sessionNavigation.openFilePreviewTab,
		onSessionTabChange,
		onSessionTabClose: sessionNavigation.closeSessionTab,
		onSessionTabOpen: sessionNavigation.openSessionTab,
		onSessionTabRestore: sessionNavigation.restoreSessionTab,
		onSessionTabsReorder: sessionNavigation.reorderSessionTabs,
		onTurnDiffOpen: sessionNavigation.openTurnDiffTab,
		sessionTabs: sessionNavigation.sessionTabs,
	};

	return (
		<WorkbenchLayoutProvider
			value={{
				state: {
					isDockCollapsed: dock.isDockCollapsed,
					isRightSidebarCollapsed: rightSidebar.isRightSidebarCollapsed,
					rightSidebarSizePercent: rightSidebar.rightSidebarSizePercent,
				},
				actions: {
					collapseRightSidebar: rightSidebar.collapseRightSidebar,
					expandRightSidebar: rightSidebar.expandRightSidebar,
					toggleDockPanel: dock.toggleDockPanel,
					handleDockResize: dock.handleDockResize,
					handleRightSidebarResize: rightSidebar.handleRightSidebarResize,
				},
				meta: {
					dockPanelRef: dock.dockPanelRef,
					rightSidebarPanelRef: rightSidebar.rightSidebarPanelRef,
				},
			}}
		>
			<ReviewActionsProvider
				activeProject={activeProject}
				activeWorkspace={activeWorkspace}
				runAgentAction={runAgentAction}
			>
				<WorkspaceFileDiffOpenerProvider value={openWorkspaceFileDiff}>
					<ReviewFilePreviewOpenerProvider value={openReviewFilePreview}>
						<CommentPreviewOpenerProvider value={openCommentPreview}>
							<WorkbenchPanelLayout
								activeProject={activeProject}
								activeReviewTab={activeReviewTab}
								activeWorkspace={activeWorkspace}
								dockActions={dockActions}
								dockTabId={dockTabId}
								mainContent={<MainContent {...mainContentState} />}
								onDockTabChange={onDockTabChange}
								onReviewTabChange={onReviewTabChange}
							/>
						</CommentPreviewOpenerProvider>
					</ReviewFilePreviewOpenerProvider>
				</WorkspaceFileDiffOpenerProvider>
			</ReviewActionsProvider>
		</WorkbenchLayoutProvider>
	);
}
