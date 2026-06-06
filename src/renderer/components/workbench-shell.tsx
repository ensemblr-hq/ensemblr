import { useEffect, useRef, useState } from 'react';
import type { PanelImperativeHandle } from 'react-resizable-panels';

import { SidebarProvider } from '@/renderer/components/ui/sidebar';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import {
	useProjectNavigationState,
	useSessionTabState,
} from '@/renderer/state/workspace';
import type { WorkbenchShellProps } from '@/renderer/types/workbench-shell';
import { WorkspaceNavigationSidebar } from './workbench-shell/navigation-sidebar';
import { WorkbenchPanelLayout } from './workbench-shell/panel-layout';

const RIGHT_SIDEBAR_MIN_VIEWPORT_WIDTH = 1024;

async function ensureWindowCanShowRightSidebar() {
	if (
		window.matchMedia(`(min-width: ${RIGHT_SIDEBAR_MIN_VIEWPORT_WIDTH}px)`)
			.matches
	) {
		return;
	}

	await window.ensemble?.ensureWindowWidth(RIGHT_SIDEBAR_MIN_VIEWPORT_WIDTH);
}

export function WorkbenchShell({
	activeProject,
	activeReviewTab,
	activeSession,
	activeView,
	activeWorkspace,
	composer,
	dockActions,
	dockTabId,
	health,
	onDockTabChange,
	onHistorySelect,
	onReviewTabChange,
	onSessionTabChange,
	onSettingsSelect,
	onWorkspaceSelect,
	projects,
	setupDiagnostics,
	setupDiagnosticsError,
	isSetupDiagnosticsRetrying,
	onSetupDiagnosticsRetry,
}: WorkbenchShellProps) {
	const rightSidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
	const dockPanelRef = useRef<PanelImperativeHandle | null>(null);
	const rightSidebarCollapsedByViewportRef = useRef(false);
	const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(false);
	const [isDockCollapsed, setIsDockCollapsed] = useState(false);
	const projectNavigation = useProjectNavigationState(projects);
	const sessionNavigation = useSessionTabState({
		activeSession,
		activeWorkspace,
		onSessionTabChange,
	});
	const collapseRightSidebar = () => {
		rightSidebarCollapsedByViewportRef.current = false;
		rightSidebarPanelRef.current?.collapse();
		setIsRightSidebarCollapsed(true);
	};
	const expandRightSidebar = async () => {
		rightSidebarCollapsedByViewportRef.current = false;
		await ensureWindowCanShowRightSidebar();

		window.requestAnimationFrame(() => {
			rightSidebarPanelRef.current?.expand();
			setIsRightSidebarCollapsed(false);
		});
	};
	const toggleDockPanel = () => {
		if (dockPanelRef.current?.isCollapsed() || isDockCollapsed) {
			dockPanelRef.current?.expand();
			setIsDockCollapsed(false);
			return;
		}

		dockPanelRef.current?.collapse();
		setIsDockCollapsed(true);
	};

	useEffect(() => {
		const narrowViewportQuery = window.matchMedia(
			`(max-width: ${RIGHT_SIDEBAR_MIN_VIEWPORT_WIDTH - 1}px)`,
		);
		let restoreFrame: number | null = null;
		const syncRightSidebarWithViewport = () => {
			if (narrowViewportQuery.matches) {
				if (restoreFrame !== null) {
					window.cancelAnimationFrame(restoreFrame);
					restoreFrame = null;
				}

				const wasAlreadyCollapsed =
					rightSidebarPanelRef.current?.isCollapsed() ||
					isRightSidebarCollapsed;

				rightSidebarPanelRef.current?.collapse();
				setIsRightSidebarCollapsed(true);

				if (!wasAlreadyCollapsed) {
					rightSidebarCollapsedByViewportRef.current = true;
				}
				return;
			}

			if (rightSidebarCollapsedByViewportRef.current) {
				restoreFrame = window.requestAnimationFrame(() => {
					rightSidebarPanelRef.current?.expand();
					setIsRightSidebarCollapsed(false);
					rightSidebarCollapsedByViewportRef.current = false;
					restoreFrame = null;
				});
			}
		};

		syncRightSidebarWithViewport();
		narrowViewportQuery.addEventListener(
			'change',
			syncRightSidebarWithViewport,
		);

		return () => {
			if (restoreFrame !== null) {
				window.cancelAnimationFrame(restoreFrame);
			}
			narrowViewportQuery.removeEventListener(
				'change',
				syncRightSidebarWithViewport,
			);
		};
	}, [isRightSidebarCollapsed]);

	return (
		<TooltipProvider>
			<SidebarProvider>
				<WorkspaceNavigationSidebar
					activeProject={activeProject}
					activeView={activeView}
					activeWorkspace={activeWorkspace}
					health={health}
					onHistorySelect={onHistorySelect}
					onSettingsSelect={onSettingsSelect}
					onWorkspaceSelect={onWorkspaceSelect}
					projectNavigation={projectNavigation}
				/>
				<WorkbenchPanelLayout
					activeProject={activeProject}
					activeReviewTab={activeReviewTab}
					activeSession={sessionNavigation.effectiveActiveSession}
					activeWorkspace={activeWorkspace}
					closedSessions={sessionNavigation.closedSessions}
					composer={composer}
					dockActions={dockActions}
					dockPanelRef={dockPanelRef}
					dockTabId={dockTabId}
					isDockCollapsed={isDockCollapsed}
					isRightSidebarCollapsed={isRightSidebarCollapsed}
					onDockResize={(isCollapsed) => setIsDockCollapsed(isCollapsed)}
					onDockTabChange={onDockTabChange}
					onDockToggle={toggleDockPanel}
					onReviewTabChange={onReviewTabChange}
					onRightSidebarCollapse={collapseRightSidebar}
					onRightSidebarOpen={expandRightSidebar}
					onRightSidebarResize={(isCollapsed) =>
						setIsRightSidebarCollapsed(isCollapsed)
					}
					onSessionTabChange={onSessionTabChange}
					onSessionTabClose={sessionNavigation.closeSessionTab}
					onSessionTabRestore={sessionNavigation.restoreSessionTab}
					rightSidebarPanelRef={rightSidebarPanelRef}
					sessionTabs={sessionNavigation.sessionTabs}
					setupDiagnostics={setupDiagnostics}
					setupDiagnosticsError={setupDiagnosticsError}
					isSetupDiagnosticsRetrying={isSetupDiagnosticsRetrying}
					onSetupDiagnosticsRetry={onSetupDiagnosticsRetry}
				/>
			</SidebarProvider>
		</TooltipProvider>
	);
}
