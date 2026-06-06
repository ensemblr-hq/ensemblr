import type { ReactElement } from 'react';

import type {
	ComposerShellState,
	DockTabId,
	ProjectShellModel,
	ReviewPanelTab,
	SessionTabModel,
	WorkbenchRouteSearch,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { SetupDiagnosticsSnapshot } from '@/shared/ipc';

export interface WorkbenchHealth {
	detail: string;
	label: string;
	state: 'online' | 'pending' | 'unavailable';
}

export interface WorkbenchDockActions {
	onNewTerminal: () => void;
	onOpenRunPort: (port: number) => void;
	onOpenSetupScripts: () => void;
	onRunScript: () => void;
	onRunSetupScript: () => void;
	onStopRunScript: () => void;
}

export type WorkbenchStaticNavigationTarget =
	| 'dashboard'
	| 'help'
	| 'history'
	| 'settings';

export interface WorkbenchWorkspaceNavigationLinkTarget {
	search: WorkbenchRouteSearch;
	workspace: WorkspaceShellModel;
}

export interface WorkbenchShellProps {
	activeProject: ProjectShellModel;
	activeReviewTab: ReviewPanelTab;
	activeSession: SessionTabModel;
	activeView: 'dashboard' | 'help' | 'history' | 'settings' | 'workspace';
	activeWorkspace: WorkspaceShellModel;
	composer: ComposerShellState;
	dockActions: WorkbenchDockActions;
	dockTabId: DockTabId;
	health: WorkbenchHealth;
	onDockTabChange: (tab: DockTabId) => void;
	onReviewTabChange: (tab: ReviewPanelTab) => void;
	onSessionTabChange: (sessionId: string) => void;
	onStaticNavigationSelect: (target: WorkbenchStaticNavigationTarget) => void;
	onWorkspaceSelect: (projectId: string, workspaceId: string) => void;
	projects: ProjectShellModel[];
	renderStaticNavigationLink?: (
		target: WorkbenchStaticNavigationTarget,
		children: ReactElement,
	) => ReactElement;
	renderWorkspaceNavigationLink?: (
		target: WorkbenchWorkspaceNavigationLinkTarget,
		children: ReactElement,
	) => ReactElement;
	resolveWorkspaceRouteSearch?: (
		workspace: WorkspaceShellModel,
	) => WorkbenchRouteSearch;
	setupDiagnostics: SetupDiagnosticsSnapshot | null;
	setupDiagnosticsError?: string | null;
	isSetupDiagnosticsRetrying?: boolean;
	onSetupDiagnosticsRetry?: () => void;
}

export type WorkbenchActiveView = WorkbenchShellProps['activeView'];

export interface WorkspaceEntry {
	project: ProjectShellModel;
	workspace: WorkspaceShellModel;
}

export interface ProjectNavigationState {
	collapsedProjectIdSet: Set<string>;
	isProjectReorderLayoutAnimationDisabled: boolean;
	isProjectReorderPositionOnlyLayout: boolean;
	orderedProjects: ProjectShellModel[];
	pinnedWorkspaceEntries: WorkspaceEntry[];
	pinnedWorkspaceIdSet: Set<string>;
	reorderProjects: (reorderedElements: ReactElement[]) => void;
	toggleProjectCollapsed: (projectId: string) => void;
	toggleWorkspacePinned: (workspaceId: string) => void;
}

export interface SessionTabState {
	closedSessions: SessionTabModel[];
	closeSessionTab: (sessionId: string) => void;
	effectiveActiveSession: SessionTabModel;
	restoreSessionTab: (sessionId: string) => void;
	sessionTabs: SessionTabModel[];
}

export type ChangesViewMode = 'folders' | 'list';
