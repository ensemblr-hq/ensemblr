import { useCallback } from 'react';

import {
	useMenuCommand,
	useMenuCommandChecked,
} from '@/renderer/state/menu-commands';

/**
 * Registers the View menu's layout toggles for the workspace shell.
 *
 * The dock and right sidebar had no keyboard path at all before this — they were
 * reachable only by dragging or clicking their handles — so these two commands
 * own their accelerators rather than mirroring an existing renderer hotkey.
 * @param dock - Dock collapse state and its toggle
 * @param rightSidebar - Right-sidebar collapse state and its collapse/expand pair
 */
export function useLayoutMenuCommands(
	dock: { isDockCollapsed: boolean; toggleDockPanel: () => void },
	rightSidebar: {
		collapseRightSidebar: () => void;
		expandRightSidebar: () => void;
		isRightSidebarCollapsed: boolean;
	},
): void {
	const { isDockCollapsed, toggleDockPanel } = dock;
	const { collapseRightSidebar, expandRightSidebar, isRightSidebarCollapsed } =
		rightSidebar;

	const toggleDock = useCallback(() => {
		toggleDockPanel();
	}, [toggleDockPanel]);

	const toggleRightSidebar = useCallback(() => {
		if (isRightSidebarCollapsed) {
			expandRightSidebar();
			return;
		}
		collapseRightSidebar();
	}, [collapseRightSidebar, expandRightSidebar, isRightSidebarCollapsed]);

	useMenuCommand('layout.toggleDock', toggleDock);
	useMenuCommandChecked('layout.toggleDock', !isDockCollapsed);
	useMenuCommand('layout.toggleRightSidebar', toggleRightSidebar);
	useMenuCommandChecked('layout.toggleRightSidebar', !isRightSidebarCollapsed);
}
