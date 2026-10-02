import { useAtomValue } from 'jotai';
import { GripVertical, Maximize2, Minimize2, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { SidebarTrigger, useSidebar } from '@/renderer/components/ui/sidebar';
import { conciergeSidebarEdgeLabel } from '@/renderer/lib/concierge';
import { cn } from '@/renderer/lib/utils';
import { windowChromeInsetsPx } from '@/renderer/lib/window-chrome';
import { TOOLBAR_HEIGHT_CLASS } from '@/renderer/lib/workbench/shell-inset';
import { windowChromeAtom } from '@/renderer/state/window-chrome';

import { ConciergeMark } from './concierge-mark';

/** Props for the Concierge panel's title bar. */
interface ConciergePanelHeaderProps {
	/** Left edge of the shell inset the maximized panel covers, or null while docked. */
	insetLeft: number | null;
	isClearing: boolean;
	isFullscreen: boolean;
	onClear: () => void;
	onClose: () => void;
	onPointerDown: (event: { clientX: number; clientY: number }) => void;
	onToggleFullscreen: () => void;
}

/**
 * The Concierge panel's title bar: drag handle, clear, maximize, and close.
 *
 * Only the docked bar maximizes on a double-click. Maximized, the header spans
 * the window's own title area, where macOS has already claimed that gesture for
 * zoom — so restoring is left to the button and its chord. Maximized it also
 * covers the navigation sidebar's only trigger wherever Ensemblr draws the
 * title bar itself, so it carries one of its own.
 */
export function ConciergePanelHeader({
	insetLeft,
	isClearing,
	isFullscreen,
	onClear,
	onClose,
	onPointerDown,
	onToggleFullscreen,
}: ConciergePanelHeaderProps) {
	const { t } = useTranslation();
	const { state: sidebarState } = useSidebar();
	const sidebarIsCollapsed = sidebarState === 'collapsed';
	const windowChrome = useAtomValue(windowChromeAtom);
	const clearsLeadingChrome =
		(insetLeft ?? 0) >= windowChromeInsetsPx(windowChrome).start;
	// Where Ensemblr draws the title bar the nav sidebar has no header strip, so
	// a maximized panel covers the only trigger there is — open or collapsed.
	const showsSidebarTrigger =
		sidebarIsCollapsed || windowChrome.drawsOwnControls;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a docked title bar that maximizes on double-click, as a window's own does; the labelled Maximize button beside it is the keyboard route
		<header
			className={cn(
				'flex shrink-0 select-none items-center gap-0.5 border-b',
				// Maximized, this header sits beside the sidebar's own — so it takes
				// the shell toolbar's height, padding, and full-strength border, or
				// the two rules miss each other and the title crowds the divider.
				// It also spans the window's leading top corner, where macOS draws
				// the traffic lights over the web contents — cleared by the same
				// inset the shell's own toolbars take.
				isFullscreen
					? cn(
							'border-border pr-2',
							TOOLBAR_HEIGHT_CLASS,
							clearsLeadingChrome
								? 'pl-3'
								: 'pl-(--ensemblr-window-chrome-safe-start)',
						)
					: 'h-10 cursor-grab border-border/60 pr-1.5 pl-1 active:cursor-grabbing',
			)}
			onDoubleClick={isFullscreen ? undefined : onToggleFullscreen}
			onPointerDown={onPointerDown}
		>
			{isFullscreen ? null : (
				<GripVertical
					aria-hidden='true'
					className='size-4 shrink-0 text-muted-foreground/50'
				/>
			)}
			{isFullscreen && showsSidebarTrigger ? (
				<SidebarTrigger
					aria-label={conciergeSidebarEdgeLabel(sidebarIsCollapsed, t)}
					className='mr-1'
					onDoubleClick={stopHeaderGesture}
				/>
			) : null}
			<ConciergeMark className='mx-1 size-4 shrink-0 text-muted-foreground' />
			<h2 className='flex-1 truncate font-medium text-sm'>
				{t('workbench:concierge.panel.title', 'Concierge')}
			</h2>
			<Button
				aria-label={t(
					'workbench:concierge.panel.clear',
					'Clear context and start over',
				)}
				disabled={isClearing}
				onClick={onClear}
				onDoubleClick={stopHeaderGesture}
				onPointerDown={stopHeaderGesture}
				size='icon-sm'
				variant='ghost'
			>
				<RotateCcw aria-hidden='true' className='size-4' />
			</Button>
			<Button
				aria-label={
					isFullscreen
						? t('workbench:concierge.panel.restore', 'Restore panel')
						: t('workbench:concierge.panel.maximize', 'Maximize')
				}
				onClick={onToggleFullscreen}
				onDoubleClick={stopHeaderGesture}
				onPointerDown={stopHeaderGesture}
				size='icon-sm'
				variant='ghost'
			>
				{isFullscreen ? (
					<Minimize2 aria-hidden='true' className='size-4' />
				) : (
					<Maximize2 aria-hidden='true' className='size-4' />
				)}
			</Button>
			<Button
				aria-label={t('common:actions.close', 'Close')}
				onClick={onClose}
				onDoubleClick={stopHeaderGesture}
				onPointerDown={stopHeaderGesture}
				size='icon-sm'
				variant='ghost'
			>
				<X aria-hidden='true' className='size-4' />
			</Button>
		</header>
	);
}

/**
 * Keeps a header control's own press from reaching the title bar behind it,
 * which would otherwise start a drag of the whole panel or — on the second
 * click of a double — maximize it out from under the button being pressed.
 * @param event - The pointer-down or double-click on the control.
 */
function stopHeaderGesture(event: { stopPropagation: () => void }): void {
	event.stopPropagation();
}
