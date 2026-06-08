import type { ReactNode } from 'react';

import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '@/renderer/components/ui/resizable';
import { SidebarInset } from '@/renderer/components/ui/sidebar';
import type {
	DockTabId,
	ProjectShellModel,
	ReviewPanelTab,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { WorkbenchDockActions } from '@/renderer/types/workbench-shell';
import { DockPanel } from './dock-panel/dock-panel';
import { ReviewPanel } from './review-panel';
import { RightSidebarHeader } from './right-sidebar-header/right-sidebar-header';
import { useWorkbenchLayout } from './shell-contexts';
import { WorkbenchHeader } from './workbench-header';

/** Top-level resizable layout housing the main workspace and the review dock. */
export function WorkbenchPanelLayout({
	activeProject,
	activeReviewTab,
	activeWorkspace,
	dockActions,
	dockTabId,
	mainContent,
	onDockTabChange,
	onReviewTabChange,
}: {
	activeProject: ProjectShellModel;
	activeReviewTab: ReviewPanelTab;
	activeWorkspace: WorkspaceShellModel;
	dockActions: WorkbenchDockActions;
	dockTabId: DockTabId;
	mainContent: ReactNode;
	onDockTabChange: (tab: DockTabId) => void;
	onReviewTabChange: (tab: ReviewPanelTab) => void;
}) {
	return (
		<SidebarInset className='flex h-svh min-h-svh overflow-hidden bg-background text-foreground'>
			<ResizablePanelGroup className='min-h-0 flex-1' orientation='horizontal'>
				<MainWorkspacePanel
					activeProject={activeProject}
					activeWorkspace={activeWorkspace}
				>
					{mainContent}
				</MainWorkspacePanel>
				<ResizableHandle className='hidden lg:flex' />
				<ReviewDockPanel
					activeReviewTab={activeReviewTab}
					activeWorkspace={activeWorkspace}
					dockActions={dockActions}
					dockTabId={dockTabId}
					onDockTabChange={onDockTabChange}
					onReviewTabChange={onReviewTabChange}
				/>
			</ResizablePanelGroup>
		</SidebarInset>
	);
}

/** Left resizable panel containing the workbench header and main content. */
function MainWorkspacePanel({
	activeProject,
	activeWorkspace,
	children,
}: {
	activeProject: ProjectShellModel;
	activeWorkspace: WorkspaceShellModel;
	children: ReactNode;
}) {
	return (
		<ResizablePanel defaultSize='66%' minSize='32rem'>
			<div className='flex h-full min-w-0 flex-col overflow-hidden'>
				<WorkbenchHeader
					activeProject={activeProject}
					activeWorkspace={activeWorkspace}
				/>
				{children}
			</div>
		</ResizablePanel>
	);
}

/** Right-hand collapsible review panel plus the bottom dock panel group. */
function ReviewDockPanel({
	activeReviewTab,
	activeWorkspace,
	dockActions,
	dockTabId,
	onDockTabChange,
	onReviewTabChange,
}: {
	activeReviewTab: ReviewPanelTab;
	activeWorkspace: WorkspaceShellModel;
	dockActions: WorkbenchDockActions;
	dockTabId: DockTabId;
	onDockTabChange: (tab: DockTabId) => void;
	onReviewTabChange: (tab: ReviewPanelTab) => void;
}) {
	const { state, actions, meta } = useWorkbenchLayout();

	return (
		<ResizablePanel
			className='hidden min-w-0 lg:flex'
			collapsedSize='0rem'
			collapsible
			defaultSize={
				state.isRightSidebarCollapsed
					? '0rem'
					: `${state.rightSidebarSizePercent}%`
			}
			maxSize='68%'
			minSize='22rem'
			onResize={actions.handleRightSidebarResize}
			panelRef={meta.rightSidebarPanelRef}
		>
			<aside className='flex h-full w-full min-w-0 flex-col bg-card'>
				<RightSidebarHeader activeWorkspace={activeWorkspace} />
				<ResizablePanelGroup className='min-h-0 flex-1' orientation='vertical'>
					<ResizablePanel className='min-h-0' defaultSize='62%' minSize='8rem'>
						<ReviewPanel
							activeTab={activeReviewTab}
							onTabChange={onReviewTabChange}
							workspace={activeWorkspace}
						/>
					</ResizablePanel>
					<ResizableHandle withHandle />
					<ResizablePanel
						className='min-h-0'
						collapsedSize='2.25rem'
						collapsible
						defaultSize='18rem'
						groupResizeBehavior='preserve-pixel-size'
						maxSize='70%'
						minSize='9rem'
						onResize={(size) => {
							actions.handleDockResize(size.inPixels <= 40);
						}}
						panelRef={meta.dockPanelRef}
					>
						<DockPanel
							actions={dockActions}
							activeTab={dockTabId}
							onTabChange={onDockTabChange}
							workspace={activeWorkspace}
						/>
					</ResizablePanel>
				</ResizablePanelGroup>
			</aside>
		</ResizablePanel>
	);
}
