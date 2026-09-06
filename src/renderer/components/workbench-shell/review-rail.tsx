import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '@/renderer/components/ui/resizable';
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from '@/renderer/components/ui/sheet';
import type {
	DockTabId,
	ReviewPanelTab,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { WorkbenchDockActions } from '@/renderer/types/workbench-shell';
import { DockPanel } from './dock-panel/dock-panel';
import { ReviewPanel } from './review-panel';
import { RightSidebarHeader } from './right-sidebar-header/right-sidebar-header';
import { useWorkbenchLayout } from './shell-contexts';

/** Everything the review rail renders, in either of the two hosts below. */
export interface ReviewRailProps {
	activeReviewTab: ReviewPanelTab;
	activeWorkspace: WorkspaceShellModel;
	dockActions: WorkbenchDockActions;
	dockTabId: DockTabId;
	onDockTabChange: (tab: DockTabId) => void;
	onFileSearchOpen: () => void;
	onReviewTabChange: (tab: ReviewPanelTab) => void;
}

/**
 * The review rail's contents: the pull-request header over the review surface
 * and the terminal dock. Rendered by exactly one host at a time — the resizable
 * panel beside the content on a wide window, {@link ReviewRailSheet} over it on
 * a narrow one — so the terminals and queries inside it exist once.
 *
 * `onDismiss` adds the close affordance the sheet needs, since the toolbar toggle
 * that would otherwise close the rail sits behind the overlay.
 */
export function ReviewRail({
	activeReviewTab,
	activeWorkspace,
	dockActions,
	dockTabId,
	onDismiss,
	onDockTabChange,
	onFileSearchOpen,
	onReviewTabChange,
}: ReviewRailProps & { onDismiss?: () => void }) {
	const { actions, meta } = useWorkbenchLayout();

	return (
		<aside className='flex h-full min-h-0 w-full min-w-0 flex-col bg-card'>
			<RightSidebarHeader
				activeWorkspace={activeWorkspace}
				onDismiss={onDismiss}
			/>
			<ResizablePanelGroup className='min-h-0 flex-1' orientation='vertical'>
				<ResizablePanel className='min-h-0' defaultSize='62%' minSize='8rem'>
					<ReviewPanel
						activeTab={activeReviewTab}
						onFileSearchOpen={onFileSearchOpen}
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
						actions.handleDockResize(size.inPixels <= 40);
					}}
					panelRef={meta.dockPanelRef}
				>
					<DockPanel
						actions={dockActions}
						activeTab={dockTabId}
						onTabChange={onDockTabChange}
						workspace={activeWorkspace}
					/>
				</ResizablePanel>
			</ResizablePanelGroup>
		</aside>
	);
}

/**
 * Narrow-window host for the review rail: a sheet that slides in over the
 * content when something calls the rail, rather than the resizable panel there
 * is no room for. The width classes carry the primitive's own `data-[side]`
 * modifier so they replace its defaults instead of racing them.
 */
export function ReviewRailSheet(props: ReviewRailProps) {
	const { t } = useTranslation();
	const { state, actions } = useWorkbenchLayout();
	const sheetRef = useRef<HTMLDivElement | null>(null);
	// A press the rail itself consumed is not a press outside the sheet.
	// `react-resizable-panels` (v4, `PanelGroup`'s document `pointerdown` listener)
	// and xterm both call `preventDefault()` in the document's *capture* phase,
	// before React's delegated listener runs, so Radix never learns the press
	// reached its own layer and reads a divider drag or a terminal selection as a
	// click on the overlay. Re-check this when either dependency moves.
	const keepSheetOpenForOwnPointerDown = useCallback(
		(event: CustomEvent<{ originalEvent: PointerEvent }>) => {
			const target = event.detail.originalEvent.target;

			if (target instanceof Node && sheetRef.current?.contains(target)) {
				event.preventDefault();
			}
		},
		[],
	);

	return (
		<Sheet
			onOpenChange={actions.setRightSidebarSheetOpen}
			open={state.isRightSidebarSheetOpen}
		>
			<SheetContent
				className='gap-0 data-[side=right]:w-11/12 data-[side=right]:sm:max-w-128'
				onPointerDownOutside={keepSheetOpenForOwnPointerDown}
				ref={sheetRef}
				showCloseButton={false}
				side='right'
			>
				<SheetHeader className='sr-only'>
					<SheetTitle>
						{t('workbench:review-rail-sheet.title', 'Review sidebar')}
					</SheetTitle>
					<SheetDescription>
						{t(
							'workbench:review-rail-sheet.description',
							'Pull request status, files, changes, checks and the terminal area for this workspace.',
						)}
					</SheetDescription>
				</SheetHeader>
				<ReviewRail
					{...props}
					onDismiss={() => actions.setRightSidebarSheetOpen(false)}
				/>
			</SheetContent>
		</Sheet>
	);
}
