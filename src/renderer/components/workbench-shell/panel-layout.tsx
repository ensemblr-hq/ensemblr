import type { ReactNode, RefObject } from 'react';
import type { PanelImperativeHandle, PanelSize } from 'react-resizable-panels';

import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '@/renderer/components/ui/resizable';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { SidebarInset } from '@/renderer/components/ui/sidebar';
import type {
	ComposerShellState,
	DockTabId,
	ProjectShellModel,
	ReviewPanelTab,
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { WorkbenchDockActions } from '@/renderer/types/workbench-shell';
import type { SetupDiagnosticsSnapshot } from '@/shared/ipc';

import {
	ComposerPanel,
	SessionTabs,
	WorkspaceTimeline,
} from './conversation-panel';
import { DockPanel } from './dock-panel';
import { ReviewPanel } from './review-panel';
import { RightSidebarHeader } from './right-sidebar-header';
import { WorkbenchHeader } from './workbench-header';

export function WorkbenchPanelLayout({
	activeProject,
	activeReviewTab,
	activeWorkspace,
	dockActions,
	dockPanelRef,
	dockTabId,
	isDockCollapsed,
	isRightSidebarCollapsed,
	mainContent,
	onDockResize,
	onDockTabChange,
	onDockToggle,
	onReviewTabChange,
	onRightSidebarCollapse,
	onRightSidebarOpen,
	onRightSidebarResize,
	rightSidebarPanelRef,
	rightSidebarSizePercent,
}: {
	activeProject: ProjectShellModel;
	activeReviewTab: ReviewPanelTab;
	activeWorkspace: WorkspaceShellModel;
	dockActions: WorkbenchDockActions;
	dockPanelRef: RefObject<PanelImperativeHandle | null>;
	dockTabId: DockTabId;
	isDockCollapsed: boolean;
	isRightSidebarCollapsed: boolean;
	mainContent: ReactNode;
	onDockResize: (isCollapsed: boolean) => void;
	onDockTabChange: (tab: DockTabId) => void;
	onDockToggle: () => void;
	onReviewTabChange: (tab: ReviewPanelTab) => void;
	onRightSidebarCollapse: () => void;
	onRightSidebarOpen: () => void;
	onRightSidebarResize: (size: PanelSize) => void;
	rightSidebarPanelRef: RefObject<PanelImperativeHandle | null>;
	rightSidebarSizePercent: number;
}) {
	return (
		<SidebarInset className='flex h-svh min-h-svh overflow-hidden bg-background text-foreground'>
			<ResizablePanelGroup className='min-h-0 flex-1' orientation='horizontal'>
				<MainWorkspacePanel
					activeProject={activeProject}
					activeWorkspace={activeWorkspace}
					isRightSidebarCollapsed={isRightSidebarCollapsed}
					onRightSidebarCollapse={onRightSidebarCollapse}
					onRightSidebarOpen={onRightSidebarOpen}
				>
					{mainContent}
				</MainWorkspacePanel>
				<ResizableHandle className='hidden lg:flex' />
				<ReviewDockPanel
					activeReviewTab={activeReviewTab}
					activeWorkspace={activeWorkspace}
					dockActions={dockActions}
					dockPanelRef={dockPanelRef}
					dockTabId={dockTabId}
					isDockCollapsed={isDockCollapsed}
					isRightSidebarCollapsed={isRightSidebarCollapsed}
					onDockResize={onDockResize}
					onDockTabChange={onDockTabChange}
					onDockToggle={onDockToggle}
					onReviewTabChange={onReviewTabChange}
					onRightSidebarResize={onRightSidebarResize}
					rightSidebarPanelRef={rightSidebarPanelRef}
					rightSidebarSizePercent={rightSidebarSizePercent}
				/>
			</ResizablePanelGroup>
		</SidebarInset>
	);
}

function MainWorkspacePanel({
	activeProject,
	activeWorkspace,
	children,
	isRightSidebarCollapsed,
	onRightSidebarCollapse,
	onRightSidebarOpen,
}: {
	activeProject: ProjectShellModel;
	activeWorkspace: WorkspaceShellModel;
	children: ReactNode;
	isRightSidebarCollapsed: boolean;
	onRightSidebarCollapse: () => void;
	onRightSidebarOpen: () => void;
}) {
	return (
		<ResizablePanel defaultSize='66%' minSize='32rem'>
			<div className='flex h-full min-w-0 flex-col overflow-hidden'>
				<WorkbenchHeader
					activeProject={activeProject}
					activeWorkspace={activeWorkspace}
					isRightSidebarCollapsed={isRightSidebarCollapsed}
					onRightSidebarCollapse={onRightSidebarCollapse}
					onRightSidebarOpen={onRightSidebarOpen}
				/>
				{children}
			</div>
		</ResizablePanel>
	);
}

export function WorkspaceConversationContent({
	activeSession,
	activeWorkspace,
	closedSessions,
	composer,
	onSessionTabChange,
	onSessionTabClose,
	onSessionTabRestore,
	sessionTabs,
	setupDiagnostics,
	setupDiagnosticsError,
	isSetupDiagnosticsRetrying,
	onSetupDiagnosticsRetry,
}: {
	activeSession: SessionTabModel;
	activeWorkspace: WorkspaceShellModel;
	closedSessions: SessionTabModel[];
	composer: ComposerShellState;
	onSessionTabChange: (sessionId: string) => void;
	onSessionTabClose: (sessionId: string) => void;
	onSessionTabRestore: (sessionId: string) => void;
	sessionTabs: SessionTabModel[];
	setupDiagnostics: SetupDiagnosticsSnapshot | null;
	setupDiagnosticsError?: string | null;
	isSetupDiagnosticsRetrying?: boolean;
	onSetupDiagnosticsRetry?: () => void;
}) {
	return (
		<section className='flex min-h-0 flex-1 flex-col overflow-hidden'>
			<SessionTabs
				activeSession={activeSession}
				closedSessions={closedSessions}
				onSessionTabClose={onSessionTabClose}
				onSessionTabChange={onSessionTabChange}
				onSessionTabRestore={onSessionTabRestore}
				sessions={sessionTabs}
			/>
			<ScrollArea className='min-h-0 flex-1'>
				<WorkspaceTimeline
					activeSession={activeSession}
					composer={composer}
					setupDiagnostics={setupDiagnostics}
					setupDiagnosticsError={setupDiagnosticsError}
					isSetupDiagnosticsRetrying={isSetupDiagnosticsRetrying}
					onSetupDiagnosticsRetry={onSetupDiagnosticsRetry}
					workspace={activeWorkspace}
				/>
			</ScrollArea>
			<ComposerPanel composer={composer} />
		</section>
	);
}

function ReviewDockPanel({
	activeReviewTab,
	activeWorkspace,
	dockActions,
	dockPanelRef,
	dockTabId,
	isDockCollapsed,
	isRightSidebarCollapsed,
	onDockResize,
	onDockTabChange,
	onDockToggle,
	onReviewTabChange,
	onRightSidebarResize,
	rightSidebarPanelRef,
	rightSidebarSizePercent,
}: {
	activeReviewTab: ReviewPanelTab;
	activeWorkspace: WorkspaceShellModel;
	dockActions: WorkbenchDockActions;
	dockPanelRef: RefObject<PanelImperativeHandle | null>;
	dockTabId: DockTabId;
	isDockCollapsed: boolean;
	isRightSidebarCollapsed: boolean;
	onDockResize: (isCollapsed: boolean) => void;
	onDockTabChange: (tab: DockTabId) => void;
	onDockToggle: () => void;
	onReviewTabChange: (tab: ReviewPanelTab) => void;
	onRightSidebarResize: (size: PanelSize) => void;
	rightSidebarPanelRef: RefObject<PanelImperativeHandle | null>;
	rightSidebarSizePercent: number;
}) {
	return (
		<ResizablePanel
			className='hidden min-w-0 lg:flex'
			collapsedSize='0rem'
			collapsible
			defaultSize={
				isRightSidebarCollapsed ? '0rem' : `${rightSidebarSizePercent}%`
			}
			maxSize='68%'
			minSize='22rem'
			onResize={onRightSidebarResize}
			panelRef={rightSidebarPanelRef}
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
							onDockResize(size.inPixels <= 40);
						}}
						panelRef={dockPanelRef}
					>
						<DockPanel
							actions={dockActions}
							activeTab={dockTabId}
							isCollapsed={isDockCollapsed}
							onTabChange={onDockTabChange}
							onToggleCollapsed={onDockToggle}
							workspace={activeWorkspace}
						/>
					</ResizablePanel>
				</ResizablePanelGroup>
			</aside>
		</ResizablePanel>
	);
}
