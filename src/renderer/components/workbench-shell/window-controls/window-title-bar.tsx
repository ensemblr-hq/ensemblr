import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { closeWindow, minimizeWindow } from '@/renderer/api/ensemblr';
import { EnsemblrWordmark } from '@/renderer/components/ensemblr-wordmark';

import { AppMenuBar } from './app-menu-bar';
import { useDragRegionDoubleClick } from './use-drag-region-double-click';
import { useMenuBar } from './use-menu-bar';
import { useWindowMaximized } from './use-window-maximized';
import { WindowControlCluster } from './window-controls';

/**
 * The title bar Ensemblr draws for itself where the desktop draws none — a
 * strip across the window's top edge carrying the wordmark and the minimize /
 * maximize / close cluster.
 *
 * A strip rather than an overlay because the cluster used to float over
 * whichever toolbar happened to reach the window's trailing edge, which on a
 * narrow review sidebar left the pull-request header fighting three buttons for
 * one row. `body` pads by the same inset the strip is tall, so the app's content
 * starts below it rather than underneath it — and no toolbar's drag region
 * overlaps the buttons, which is what made them unclickable: Chromium unions
 * the draggable rects in document order, so a toolbar drawn after the cluster
 * covered the holes its buttons had punched in the region.
 *
 * Portalled to the very start of `document.body` rather than left inside
 * `#root`: the strip is the window's only decoration, so it has to outrank a
 * Radix overlay that portals to the body behind it, and it has to come before
 * the app in tab and reading order rather than after the entire route tree.
 *
 * Close goes through `closeWindow`, which fires the window's `close` event and
 * therefore the quit confirmation. Calling `app.quit()` here would kill running
 * agents without asking.
 */
export function WindowTitleBar() {
	const { maximized, toggle } = useWindowMaximized();
	const { menuBar, select } = useMenuBar();
	const container = useTitleBarContainer();

	const toggleMaximize = useCallback(() => {
		void toggle();
	}, [toggle]);

	useDragRegionDoubleClick(toggleMaximize);

	return createPortal(
		// `z-100` and `pointer-events-auto` are what survive an open modal: a
		// Radix overlay is also `z-50`, and its modal layer nulls pointer events on
		// the body, which would otherwise leave the window with no way to close.
		<div className='pointer-events-auto fixed inset-x-0 top-0 z-100'>
			<WindowTitleBarSurface
				isMaximized={maximized}
				menu={<AppMenuBar menuBar={menuBar} onSelect={select} />}
				onClose={() => void closeWindow()}
				onMinimize={() => void minimizeWindow()}
				onToggleMaximize={toggleMaximize}
			/>
		</div>,
		container,
	);
}

/** What the title-bar strip needs to draw itself, with no window plumbing. */
interface WindowTitleBarSurfaceProps {
	isMaximized: boolean;
	/**
	 * The application menu, drawn between the wordmark and the controls. A slot
	 * rather than a descriptor so the strip stays presentational and the
	 * playground can mount the bar without a preload bridge behind it.
	 */
	menu?: ReactNode;
	onClose: () => void;
	onMinimize: () => void;
	onToggleMaximize: () => void;
}

/**
 * The strip itself, with no window plumbing, so the title bar above and the
 * playground can each mount the same markup.
 *
 * The wordmark sits here rather than in the navigation sidebar's own title-bar
 * strip wherever this one is drawn: two wordmarks a row apart read as a bug, and
 * an empty band across the window reads as one too. It takes the same `h-3.5`
 * that strip used, which is the smallest height the pixel grid survives.
 *
 * The menu slot fills the band between the wordmark and the controls, which is
 * the room a desktop title bar spends on a window title Ensemblr has no use
 * for. The slot keeps its width whether or not it holds a menu, so the drag
 * region stays the same shape on a system-decorated window.
 */
export function WindowTitleBarSurface({
	isMaximized,
	menu,
	onClose,
	onMinimize,
	onToggleMaximize,
}: WindowTitleBarSurfaceProps) {
	return (
		<div className='window-title-bar flex items-center gap-2 border-border border-b pl-3'>
			<EnsemblrWordmark className='h-3.5 shrink-0 text-muted-foreground' />
			<div className='flex min-w-0 flex-1 items-center self-stretch'>
				{menu}
			</div>
			<WindowControlCluster
				isMaximized={isMaximized}
				onClose={onClose}
				onMinimize={onMinimize}
				onToggleMaximize={onToggleMaximize}
			/>
		</div>
	);
}

/**
 * Creates the host element the strip portals into and keeps it as the first
 * child of `document.body`, which is what puts the window controls ahead of the
 * app in tab order while still leaving them outside `#root`'s stacking context.
 * @returns The host element, attached for as long as the component is mounted.
 */
function useTitleBarContainer(): HTMLElement {
	const [container] = useState(() => {
		const element = document.createElement('div');
		element.dataset.windowTitleBar = '';
		return element;
	});

	useEffect(() => {
		document.body.prepend(container);
		return () => container.remove();
	}, [container]);

	return container;
}
