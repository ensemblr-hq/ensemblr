import type { ReactNode } from 'react';

import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '@/renderer/components/ui/resizable';
import { SidebarInset } from '@/renderer/components/ui/sidebar';
import { RIGHT_SIDEBAR_COLLAPSED_SIZE } from '@/renderer/hooks/workbench-shell/use-right-sidebar-controller';
import { SHELL_INSET_CLASS } from '@/renderer/lib/workbench/shell-inset';
import type {
	DockTabId,
	ProjectShellModel,
	ReviewPanelTab,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { WorkbenchDockActions } from '@/renderer/types/workbench-shell';
import {
	ReviewRail,
	type ReviewRailProps,
	ReviewRailSheet,
} from './review-rail';
import { useWorkbenchLayout } from './shell-contexts';
import { WorkbenchHeader } from './workbench-header';

/** Top-level resizable layout housing the main workspace and the review dock. */
export function WorkbenchPanelLayout({
	activeProject,
	activeReviewTab,
	activeWorkspace,
	dockActions,
	dockTabId,
	mainContent,
	onDockTabChange,
	onFileSearchOpen,
	onReviewTabChange,
}: {
	activeProject: ProjectShellModel;
	activeReviewTab: ReviewPanelTab;
	activeWorkspace: WorkspaceShellModel;
	dockActions: WorkbenchDockActions;
	dockTabId: DockTabId;
	mainContent: ReactNode;
	onDockTabChange: (tab: DockTabId) => void;
	onFileSearchOpen: () => void;
	onReviewTabChange: (tab: ReviewPanelTab) => void;
}) {
	const railProps = {
		activeReviewTab,
		activeWorkspace,
		dockActions,
		dockTabId,
		onDockTabChange,
		onFileSearchOpen,
		onReviewTabChange,
	};

	return (
		<SidebarInset className={SHELL_INSET_CLASS}>
			<ResizablePanelGroup className='min-h-0 flex-1' orientation='horizontal'>
				<MainWorkspacePanel
					activeProject={activeProject}
					activeWorkspace={activeWorkspace}
				>
					{mainContent}
				</MainWorkspacePanel>
				<ResizableHandle className='hidden lg:flex' />
				<ReviewDockPanel {...railProps} />
			</ResizablePanelGroup>
			{/*
			  Outside the panel group on purpose: the sheet's own DOM is portalled to
			  the body, and a closed one renders nothing, so hosting it here keeps the
			  group's children to the panels and handles it lays out.
			*/}
			<NarrowReviewRailHost {...railProps} />
		</SidebarInset>
	);
}

/** Mounts the sheet host only below the width the resizable rail needs. */
function NarrowReviewRailHost(props: ReviewRailProps) {
	const { state } = useWorkbenchLayout();

	return state.isNarrowViewport ? <ReviewRailSheet {...props} /> : null;
}

/** Left resizable panel containing the workbench header and main content. */
function MainWorkspacePanel({
	activeProject,
	activeWorkspace,
	children,
}: {
	activeProject: ProjectShellModel;
	activeWorkspace: WorkspaceShellModel;
	children: ReactNode;
}) {
	return (
		<ResizablePanel defaultSize='66%' minSize='32rem'>
			<div className='flex h-full min-w-0 flex-col overflow-hidden'>
				<WorkbenchHeader
					activeProject={activeProject}
					activeWorkspace={activeWorkspace}
				/>
				{children}
			</div>
		</ResizablePanel>
	);
}

/**
 * Right-hand collapsible review panel plus the bottom dock panel group.
 *
 * The panel stays registered with the group at every width — dropping it below
 * `lg` would re-lay the group out and lose the frozen `defaultSize` the
 * persisted width is restored from, and would leave the handle beside it with no
 * neighbour. Only its contents move: below `lg` the panel is `hidden` and the
 * rail is hosted by {@link ReviewRailSheet} instead, so the rail — and the
 * terminals inside it — is mounted in exactly one place.
 */
function ReviewDockPanel(props: ReviewRailProps) {
	const { state, actions, meta } = useWorkbenchLayout();

	return (
		<ResizablePanel
			className='hidden min-w-0 lg:flex'
			collapsedSize={RIGHT_SIDEBAR_COLLAPSED_SIZE}
			collapsible
			defaultSize={state.initialRightSidebarSize}
			maxSize='68%'
			minSize='22rem'
			onResize={actions.handleRightSidebarResize}
			panelRef={meta.rightSidebarPanelRef}
		>
			{state.isNarrowViewport ? null : <ReviewRail {...props} />}
		</ResizablePanel>
	);
}
