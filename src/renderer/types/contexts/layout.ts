import type { RefObject } from 'react';
import type { PanelImperativeHandle, PanelSize } from 'react-resizable-panels';

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
