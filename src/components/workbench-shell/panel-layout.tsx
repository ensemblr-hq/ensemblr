import type { RefObject } from 'react';
import type { PanelImperativeHandle } from 'react-resizable-panels';

import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SidebarInset } from '@/components/ui/sidebar';
import type {
	ComposerShellState,
	DockTabId,
	ProjectShellModel,
	ReviewPanelTab,
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/workbench/workbench-model';
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
	activeSession,
	activeWorkspace,
	closedSessions,
	composer,
	dockPanelRef,
	dockTabId,
	isDockCollapsed,
	isRightSidebarCollapsed,
	onDockResize,
	onDockTabChange,
	onDockToggle,
	onReviewTabChange,
	onRightSidebarCollapse,
	onRightSidebarOpen,
	onRightSidebarResize,
	onSessionTabChange,
	onSessionTabClose,
	onSessionTabRestore,
	rightSidebarPanelRef,
	sessionTabs,
	setupDiagnostics,
	setupDiagnosticsError,
	isSetupDiagnosticsRetrying,
	onSetupDiagnosticsRetry,
}: {
	activeProject: ProjectShellModel;
	activeReviewTab: ReviewPanelTab;
	activeSession: SessionTabModel;
	activeWorkspace: WorkspaceShellModel;
	closedSessions: SessionTabModel[];
	composer: ComposerShellState;
	dockPanelRef: RefObject<PanelImperativeHandle | null>;
	dockTabId: DockTabId;
	isDockCollapsed: boolean;
	isRightSidebarCollapsed: boolean;
	onDockResize: (isCollapsed: boolean) => void;
	onDockTabChange: (tab: DockTabId) => void;
	onDockToggle: () => void;
	onReviewTabChange: (tab: ReviewPanelTab) => void;
	onRightSidebarCollapse: () => void;
	onRightSidebarOpen: () => void;
	onRightSidebarResize: (isCollapsed: boolean) => void;
	onSessionTabChange: (sessionId: string) => void;
	onSessionTabClose: (sessionId: string) => void;
	onSessionTabRestore: (sessionId: string) => void;
	rightSidebarPanelRef: RefObject<PanelImperativeHandle | null>;
	sessionTabs: SessionTabModel[];
	setupDiagnostics: SetupDiagnosticsSnapshot | null;
	setupDiagnosticsError?: string | null;
	isSetupDiagnosticsRetrying?: boolean;
	onSetupDiagnosticsRetry?: () => void;
}) {
	return (
		<SidebarInset className='flex h-svh min-h-svh overflow-hidden bg-background text-foreground'>
			<ResizablePanelGroup className='min-h-0 flex-1' orientation='horizontal'>
				<MainConversationPanel
					activeProject={activeProject}
					activeSession={activeSession}
					activeWorkspace={activeWorkspace}
					closedSessions={closedSessions}
					composer={composer}
					isRightSidebarCollapsed={isRightSidebarCollapsed}
					onRightSidebarCollapse={onRightSidebarCollapse}
					onRightSidebarOpen={onRightSidebarOpen}
					onSessionTabChange={onSessionTabChange}
					onSessionTabClose={onSessionTabClose}
					onSessionTabRestore={onSessionTabRestore}
					sessionTabs={sessionTabs}
					setupDiagnostics={setupDiagnostics}
					setupDiagnosticsError={setupDiagnosticsError}
					isSetupDiagnosticsRetrying={isSetupDiagnosticsRetrying}
					onSetupDiagnosticsRetry={onSetupDiagnosticsRetry}
				/>
				<ResizableHandle className='hidden lg:flex' />
				<ReviewDockPanel
					activeReviewTab={activeReviewTab}
					activeWorkspace={activeWorkspace}
					dockPanelRef={dockPanelRef}
					dockTabId={dockTabId}
					isDockCollapsed={isDockCollapsed}
					onDockResize={onDockResize}
					onDockTabChange={onDockTabChange}
					onDockToggle={onDockToggle}
					onReviewTabChange={onReviewTabChange}
					onRightSidebarResize={onRightSidebarResize}
					rightSidebarPanelRef={rightSidebarPanelRef}
				/>
			</ResizablePanelGroup>
		</SidebarInset>
	);
}

function MainConversationPanel({
	activeProject,
	activeSession,
	activeWorkspace,
	closedSessions,
	composer,
	isRightSidebarCollapsed,
	onRightSidebarCollapse,
	onRightSidebarOpen,
	onSessionTabChange,
	onSessionTabClose,
	onSessionTabRestore,
	sessionTabs,
	setupDiagnostics,
	setupDiagnosticsError,
	isSetupDiagnosticsRetrying,
	onSetupDiagnosticsRetry,
}: {
	activeProject: ProjectShellModel;
	activeSession: SessionTabModel;
	activeWorkspace: WorkspaceShellModel;
	closedSessions: SessionTabModel[];
	composer: ComposerShellState;
	isRightSidebarCollapsed: boolean;
	onRightSidebarCollapse: () => void;
	onRightSidebarOpen: () => void;
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
		<ResizablePanel defaultSize='66%' minSize='32rem'>
			<div className='flex h-full min-w-0 flex-col overflow-hidden'>
				<WorkbenchHeader
					activeProject={activeProject}
					activeWorkspace={activeWorkspace}
					isRightSidebarCollapsed={isRightSidebarCollapsed}
					onRightSidebarCollapse={onRightSidebarCollapse}
					onRightSidebarOpen={onRightSidebarOpen}
				/>
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
			</div>
		</ResizablePanel>
	);
}

function ReviewDockPanel({
	activeReviewTab,
	activeWorkspace,
	dockPanelRef,
	dockTabId,
	isDockCollapsed,
	onDockResize,
	onDockTabChange,
	onDockToggle,
	onReviewTabChange,
	onRightSidebarResize,
	rightSidebarPanelRef,
}: {
	activeReviewTab: ReviewPanelTab;
	activeWorkspace: WorkspaceShellModel;
	dockPanelRef: RefObject<PanelImperativeHandle | null>;
	dockTabId: DockTabId;
	isDockCollapsed: boolean;
	onDockResize: (isCollapsed: boolean) => void;
	onDockTabChange: (tab: DockTabId) => void;
	onDockToggle: () => void;
	onReviewTabChange: (tab: ReviewPanelTab) => void;
	onRightSidebarResize: (isCollapsed: boolean) => void;
	rightSidebarPanelRef: RefObject<PanelImperativeHandle | null>;
}) {
	return (
		<ResizablePanel
			className='hidden min-w-0 lg:flex'
			collapsedSize='0rem'
			collapsible
			defaultSize='34%'
			maxSize='68%'
			minSize='22rem'
			onResize={(size) => {
				onRightSidebarResize(size.asPercentage <= 1);
			}}
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
