import { useEffect, useMemo, useRef } from 'react';
import type { PanelSize } from 'react-resizable-panels';

import type { WorkbenchLayoutContextValue } from '@/renderer/types/contexts';
import type { useDockController } from './use-dock-controller';
import type { useRightSidebarController } from './use-right-sidebar-controller';

/** The two panel controllers the layout context is assembled from. */
interface LayoutControllers {
	dock: ReturnType<typeof useDockController>;
	rightSidebar: ReturnType<typeof useRightSidebarController>;
}

/**
 * Assembles the workbench layout context value from the two panel controllers,
 * keeping its identity until something layout-related moves.
 *
 * The controllers hand back fresh closures on every render, so a value built from
 * them directly changes whenever the shell renders, and a context consumer
 * renders with it however carefully its props are memoized. The actions here read
 * through a ref to the controllers' latest closures instead, which keeps the
 * `actions` object stable while each call still reaches current state.
 * @param controllers - The dock and right-sidebar controllers of the shell
 * @returns The context value for {@link WorkbenchLayoutProvider}
 */
export function useWorkbenchLayoutValue({
	dock,
	rightSidebar,
}: LayoutControllers): WorkbenchLayoutContextValue {
	const latest = useRef({ dock, rightSidebar });
	useEffect(() => {
		latest.current = { dock, rightSidebar };
	});

	const actions = useMemo<WorkbenchLayoutContextValue['actions']>(
		() => ({
			collapseRightSidebar: () =>
				latest.current.rightSidebar.collapseRightSidebar(),
			expandDockPanel: () => latest.current.dock.expandDockPanel(),
			expandRightSidebar: () =>
				latest.current.rightSidebar.expandRightSidebar(),
			handleDockResize: (isCollapsed: boolean) =>
				latest.current.dock.handleDockResize(isCollapsed),
			handleRightSidebarResize: (size: PanelSize) =>
				latest.current.rightSidebar.handleRightSidebarResize(size),
			setRightSidebarSheetOpen: (open: boolean) =>
				latest.current.rightSidebar.setRightSidebarSheetOpen(open),
			toggleDockPanel: () => latest.current.dock.toggleDockPanel(),
		}),
		[],
	);

	const { dockPanelRef, isDockCollapsed } = dock;
	const {
		initialRightSidebarSize,
		isNarrowViewport,
		isRightSidebarCollapsed,
		isRightSidebarSheetOpen,
		rightSidebarPanelRef,
	} = rightSidebar;

	return useMemo(
		() => ({
			actions,
			meta: { dockPanelRef, rightSidebarPanelRef },
			state: {
				initialRightSidebarSize,
				isDockCollapsed,
				isNarrowViewport,
				isRightSidebarCollapsed,
				isRightSidebarSheetOpen,
			},
		}),
		[
			actions,
			dockPanelRef,
			initialRightSidebarSize,
			isDockCollapsed,
			isNarrowViewport,
			isRightSidebarCollapsed,
			isRightSidebarSheetOpen,
			rightSidebarPanelRef,
		],
	);
}
