import { useMemo, useRef } from 'react';
import type { PanelImperativeHandle } from 'react-resizable-panels';

import { SidebarProvider } from '@/renderer/components/ui/sidebar';
import { WorkbenchLayoutProvider } from '@/renderer/components/workbench-shell/shell-contexts';
import type { WorkbenchLayoutContextValue } from '@/renderer/types/contexts';

/**
 * Supplies the two contexts `WorkbenchHeader` reads — the resizable-panel layout
 * and the navigation sidebar — so the shipped toolbar renders outside the
 * workbench route. The review sidebar defaults to collapsed because that is the
 * only configuration that mounts the inline review-header actions; the
 * window-controls scene drives it both ways, since the trailing inset the
 * toolbar reserves depends on it.
 *
 * `SidebarProvider` is built to own the viewport, so its wrapper is flattened to
 * a plain block here: a scene stacks many toolbars, and each one claiming
 * `min-h-svh` would put a screen of empty space between them.
 */
export function StubbedWorkbenchLayout({
	children,
	isRightSidebarCollapsed = true,
}: {
	children: React.ReactNode;
	isRightSidebarCollapsed?: boolean;
}) {
	const dockPanelRef = useRef<PanelImperativeHandle | null>(null);
	const rightSidebarPanelRef = useRef<PanelImperativeHandle | null>(null);

	const layout = useMemo<WorkbenchLayoutContextValue>(
		() => ({
			actions: {
				collapseRightSidebar: () => undefined,
				expandRightSidebar: () => undefined,
				handleDockResize: () => undefined,
				handleRightSidebarResize: () => undefined,
				toggleDockPanel: () => undefined,
			},
			meta: { dockPanelRef, rightSidebarPanelRef },
			state: {
				isDockCollapsed: false,
				isRightSidebarCollapsed,
				rightSidebarSizePercent: 34,
			},
		}),
		[isRightSidebarCollapsed],
	);

	return (
		<SidebarProvider className='block min-h-0'>
			<WorkbenchLayoutProvider value={layout}>
				{children}
			</WorkbenchLayoutProvider>
		</SidebarProvider>
	);
}
