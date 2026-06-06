import { useAtom } from 'jotai';
import {
	type ComponentType,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from 'react';
import type { PanelImperativeHandle, PanelSize } from 'react-resizable-panels';

import { SidebarProvider } from '@/renderer/components/ui/sidebar';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { useRouteProfilerMount } from '@/renderer/lib/instrumentation/route-profiler';
import {
	rightSidebarCollapsedAtom,
	rightSidebarSizePercentAtom,
	useProjectNavigationState,
	useSessionTabState,
} from '@/renderer/state/workspace';
import type { WorkbenchShellProps } from '@/renderer/types/workbench-shell';
import { WorkspaceNavigationSidebar } from './workbench-shell/navigation-sidebar';
import { WorkbenchPanelLayout } from './workbench-shell/panel-layout';

const RIGHT_SIDEBAR_MIN_VIEWPORT_WIDTH = 1024;
const RIGHT_SIDEBAR_DEFAULT_SIZE_PERCENT = 34;
const RIGHT_SIDEBAR_MAX_SIZE_PERCENT = 68;
const RIGHT_SIDEBAR_COLLAPSED_THRESHOLD_PERCENT = 1;

async function ensureWindowCanShowRightSidebar() {
	if (
		window.matchMedia(`(min-width: ${RIGHT_SIDEBAR_MIN_VIEWPORT_WIDTH}px)`)
			.matches
	) {
		return;
	}

	await window.ensemble?.ensureWindowWidth(RIGHT_SIDEBAR_MIN_VIEWPORT_WIDTH);
}

function getClampedRightSidebarSizePercent(sizePercent: number) {
	if (!Number.isFinite(sizePercent)) {
		return RIGHT_SIDEBAR_DEFAULT_SIZE_PERCENT;
	}

	return Math.min(
		RIGHT_SIDEBAR_MAX_SIZE_PERCENT,
		Math.max(
			RIGHT_SIDEBAR_COLLAPSED_THRESHOLD_PERCENT,
			Math.round(sizePercent * 100) / 100,
		),
	);
}

function canPersistRightSidebarResize() {
	return window.matchMedia(`(min-width: ${RIGHT_SIDEBAR_MIN_VIEWPORT_WIDTH}px)`)
		.matches;
}

export function WorkbenchFrame({
	activeProject,
	activeView,
	activeWorkspace,
	children,
	health,
	onStaticNavigationSelect,
	onWorkspaceSelect,
	projects,
	renderStaticNavigationLink,
	renderWorkspaceNavigationLink,
	resolveWorkspaceRouteSearch,
}: Pick<
	WorkbenchShellProps,
	| 'activeView'
	| 'health'
	| 'onStaticNavigationSelect'
	| 'onWorkspaceSelect'
	| 'projects'
	| 'renderStaticNavigationLink'
	| 'renderWorkspaceNavigationLink'
	| 'resolveWorkspaceRouteSearch'
> & {
	activeProject: WorkbenchShellProps['activeProject'] | null;
	activeWorkspace: WorkbenchShellProps['activeWorkspace'] | null;
	children: ReactNode;
}) {
	useRouteProfilerMount('WorkbenchFrame');

	const projectNavigation = useProjectNavigationState(projects);

	return (
		<TooltipProvider>
			<SidebarProvider>
				<WorkspaceNavigationSidebar
					activeProject={activeProject}
					activeView={activeView}
					activeWorkspace={activeWorkspace}
					health={health}
					onStaticNavigationSelect={onStaticNavigationSelect}
					onWorkspaceSelect={onWorkspaceSelect}
					projectNavigation={projectNavigation}
					projects={projects}
					resolveWorkspaceRouteSearch={
						resolveWorkspaceRouteSearch ?? resolveDefaultWorkspaceRouteSearch
					}
					renderStaticNavigationLink={renderStaticNavigationLink}
					renderWorkspaceNavigationLink={renderWorkspaceNavigationLink}
				/>
				{children}
			</SidebarProvider>
		</TooltipProvider>
	);
}

export function WorkspaceWorkbenchContent({
	activeProject,
	activeReviewTab,
	activeSession,
	activeWorkspace,
	composer,
	dockActions,
	dockTabId,
	onDockTabChange,
	onReviewTabChange,
	onSessionTabChange,
	setupDiagnostics,
	setupDiagnosticsError,
	isSetupDiagnosticsRetrying,
	onSetupDiagnosticsRetry,
	MainContent,
}: Pick<
	WorkbenchShellProps,
	| 'activeProject'
	| 'activeReviewTab'
	| 'activeSession'
	| 'activeWorkspace'
	| 'composer'
	| 'dockActions'
	| 'dockTabId'
	| 'onDockTabChange'
	| 'onReviewTabChange'
	| 'onSessionTabChange'
	| 'setupDiagnostics'
	| 'setupDiagnosticsError'
	| 'isSetupDiagnosticsRetrying'
	| 'onSetupDiagnosticsRetry'
> & {
	MainContent: ComponentType<WorkspaceMainContentState>;
}) {
	useRouteProfilerMount('WorkspaceWorkbenchContent');

	const rightSidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
	const dockPanelRef = useRef<PanelImperativeHandle | null>(null);
	const rightSidebarCollapsedByViewportRef = useRef(false);
	const [storedRightSidebarCollapsed, setStoredRightSidebarCollapsed] = useAtom(
		rightSidebarCollapsedAtom,
	);
	const [rightSidebarSizePercent, setRightSidebarSizePercent] = useAtom(
		rightSidebarSizePercentAtom,
	);
	const preferredRightSidebarSizePercent = getClampedRightSidebarSizePercent(
		rightSidebarSizePercent,
	);
	const rightSidebarCollapsedPreferenceRef = useRef(
		storedRightSidebarCollapsed,
	);
	const rightSidebarSizePercentRef = useRef(preferredRightSidebarSizePercent);
	const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(
		storedRightSidebarCollapsed,
	);
	const [isDockCollapsed, setIsDockCollapsed] = useState(false);
	const sessionNavigation = useSessionTabState({
		activeSession,
		activeWorkspace,
		onSessionTabChange,
	});
	const mainContentState: WorkspaceMainContentState = {
		activeSession: sessionNavigation.effectiveActiveSession,
		activeWorkspace,
		closedSessions: sessionNavigation.closedSessions,
		composer,
		onSessionTabChange,
		onSessionTabClose: sessionNavigation.closeSessionTab,
		onSessionTabRestore: sessionNavigation.restoreSessionTab,
		sessionTabs: sessionNavigation.sessionTabs,
		setupDiagnostics,
		setupDiagnosticsError,
		isSetupDiagnosticsRetrying,
		onSetupDiagnosticsRetry,
	};
	useEffect(() => {
		rightSidebarCollapsedPreferenceRef.current = storedRightSidebarCollapsed;
	}, [storedRightSidebarCollapsed]);
	useEffect(() => {
		rightSidebarSizePercentRef.current = preferredRightSidebarSizePercent;
	}, [preferredRightSidebarSizePercent]);
	const collapseRightSidebar = () => {
		rightSidebarCollapsedByViewportRef.current = false;
		rightSidebarPanelRef.current?.collapse();
		rightSidebarCollapsedPreferenceRef.current = true;
		setIsRightSidebarCollapsed(true);
		setStoredRightSidebarCollapsed(true);
	};
	const expandRightSidebar = async () => {
		rightSidebarCollapsedByViewportRef.current = false;
		await ensureWindowCanShowRightSidebar();

		window.requestAnimationFrame(() => {
			rightSidebarPanelRef.current?.expand();
			rightSidebarPanelRef.current?.resize(
				`${rightSidebarSizePercentRef.current}%`,
			);
			rightSidebarCollapsedPreferenceRef.current = false;
			setIsRightSidebarCollapsed(false);
			setStoredRightSidebarCollapsed(false);
		});
	};
	const handleRightSidebarResize = (size: PanelSize) => {
		const isCollapsed =
			size.asPercentage <= RIGHT_SIDEBAR_COLLAPSED_THRESHOLD_PERCENT;

		setIsRightSidebarCollapsed(isCollapsed);

		if (!canPersistRightSidebarResize()) {
			return;
		}

		setStoredRightSidebarCollapsed(isCollapsed);
		rightSidebarCollapsedPreferenceRef.current = isCollapsed;

		if (!isCollapsed) {
			const nextSizePercent = getClampedRightSidebarSizePercent(
				size.asPercentage,
			);
			rightSidebarSizePercentRef.current = nextSizePercent;
			setRightSidebarSizePercent(nextSizePercent);
		}
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

			if (
				rightSidebarCollapsedByViewportRef.current &&
				!rightSidebarCollapsedPreferenceRef.current
			) {
				restoreFrame = window.requestAnimationFrame(() => {
					rightSidebarPanelRef.current?.expand();
					rightSidebarPanelRef.current?.resize(
						`${rightSidebarSizePercentRef.current}%`,
					);
					setIsRightSidebarCollapsed(false);
					rightSidebarCollapsedByViewportRef.current = false;
					restoreFrame = null;
				});
				return;
			}

			rightSidebarCollapsedByViewportRef.current = false;
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
		<WorkbenchPanelLayout
			activeProject={activeProject}
			activeReviewTab={activeReviewTab}
			activeWorkspace={activeWorkspace}
			dockActions={dockActions}
			dockPanelRef={dockPanelRef}
			dockTabId={dockTabId}
			isDockCollapsed={isDockCollapsed}
			isRightSidebarCollapsed={isRightSidebarCollapsed}
			mainContent={<MainContent {...mainContentState} />}
			onDockResize={(isCollapsed) => setIsDockCollapsed(isCollapsed)}
			onDockTabChange={onDockTabChange}
			onDockToggle={toggleDockPanel}
			onReviewTabChange={onReviewTabChange}
			onRightSidebarCollapse={collapseRightSidebar}
			onRightSidebarOpen={expandRightSidebar}
			onRightSidebarResize={handleRightSidebarResize}
			rightSidebarSizePercent={preferredRightSidebarSizePercent}
			rightSidebarPanelRef={rightSidebarPanelRef}
		/>
	);
}

export type WorkspaceMainContentState = Pick<
	WorkbenchShellProps,
	| 'activeWorkspace'
	| 'composer'
	| 'onSessionTabChange'
	| 'setupDiagnostics'
	| 'setupDiagnosticsError'
	| 'isSetupDiagnosticsRetrying'
	| 'onSetupDiagnosticsRetry'
> & {
	activeSession: WorkbenchShellProps['activeSession'];
	closedSessions: WorkbenchShellProps['activeWorkspace']['sessions'];
	onSessionTabClose: (sessionId: string) => void;
	onSessionTabRestore: (sessionId: string) => void;
	sessionTabs: WorkbenchShellProps['activeWorkspace']['sessions'];
};

function resolveDefaultWorkspaceRouteSearch() {
	return {};
}
