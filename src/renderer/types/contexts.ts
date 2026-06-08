import type { ReactElement, RefObject } from 'react';
import type { PanelImperativeHandle, PanelSize } from 'react-resizable-panels';

import type {
	WorkbenchStaticNavigationTarget,
	WorkbenchWorkspaceNavigationLinkTarget,
} from '@/renderer/types/workbench-shell';
import type { SetupDiagnosticsSnapshot } from '@/shared/ipc';

export interface WorkbenchLayoutContextValue {
	state: {
		isDockCollapsed: boolean;
		isRightSidebarCollapsed: boolean;
		rightSidebarSizePercent: number;
	};
	actions: {
		collapseRightSidebar: () => void;
		expandRightSidebar: () => void;
		toggleDockPanel: () => void;
		handleDockResize: (isCollapsed: boolean) => void;
		handleRightSidebarResize: (size: PanelSize) => void;
	};
	meta: {
		dockPanelRef: RefObject<PanelImperativeHandle | null>;
		rightSidebarPanelRef: RefObject<PanelImperativeHandle | null>;
	};
}

export type RenderStaticLink = (
	target: WorkbenchStaticNavigationTarget,
	content: ReactElement,
) => ReactElement;

export type RenderWorkspaceLink = (
	target: WorkbenchWorkspaceNavigationLinkTarget,
	content: ReactElement,
) => ReactElement;

export interface NavigationContextValue {
	renderStaticLink: RenderStaticLink | undefined;
	renderWorkspaceLink: RenderWorkspaceLink | undefined;
}

export interface SetupDiagnosticsContextValue {
	state: {
		setupDiagnostics: SetupDiagnosticsSnapshot | null;
		setupDiagnosticsError: string | null;
		isSetupDiagnosticsRetrying: boolean;
	};
	actions: {
		onSetupDiagnosticsRetry: () => void;
	};
}
