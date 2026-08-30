import { type RefObject, useEffect } from 'react';

/**
 * The navigation sidebar: the one surface a maximized Concierge leaves
 * reachable, and the one whose rows take the user somewhere else.
 */
const NAVIGATION_SIDEBAR_SELECTOR = '[data-slot="sidebar"]';

/**
 * The controls inside that sidebar whose job is the sidebar itself rather than
 * navigation — its collapse trigger and its rail. Pressing one changes no
 * screen, so it must not cost the user their maximized panel.
 */
const SIDEBAR_CHROME_SELECTOR =
	'[data-slot="sidebar-trigger"],[data-slot="sidebar-rail"]';

/**
 * Drops a maximized Concierge back to its docked card as soon as the user
 * presses something in the navigation sidebar.
 *
 * Maximized, the panel covers the shell inset but not the navigation sidebar,
 * so picking a workspace there leaves the app on a different screen with the
 * panel still claiming to be maximized — and since the launcher bubble hides
 * whenever the Concierge is open, there is nothing left to press to get back to
 * it. Restoring on the press that navigates away is what keeps that from being
 * a dead end.
 *
 * Navigating away is the whole trigger, which is why the sidebar is named
 * rather than everything outside the panel being treated as one. "Outside"
 * swept in far too much: the window-control cluster that floats over the top
 * right, the sidebar's own collapse trigger, and — because a modal Radix layer
 * sets `pointer-events: none` on the body while it is open — the `<html>`
 * element every dismissing click on a menu or a dialog backdrop hit-tests to.
 * Each of those un-maximized a panel the user had not navigated away from.
 *
 * The listener runs in the capture phase so a surface that stops propagation on
 * its own rows cannot swallow it.
 * @param isFullscreen - Whether the panel is currently maximized.
 * @param panelRef - The panel element presses are measured against.
 * @param restore - Puts the panel back to its docked presentation.
 */
export function useConciergeRestoreOnOutsidePress(
	isFullscreen: boolean,
	panelRef: RefObject<HTMLElement | null>,
	restore: () => void,
): void {
	useEffect(() => {
		if (!isFullscreen) {
			return;
		}

		const handlePointerDown = (event: PointerEvent) => {
			const panel = panelRef.current;
			const { target } = event;
			if (!panel || !(target instanceof Element) || panel.contains(target)) {
				return;
			}
			if (!target.closest(NAVIGATION_SIDEBAR_SELECTOR)) {
				return;
			}
			if (target.closest(SIDEBAR_CHROME_SELECTOR)) {
				return;
			}
			restore();
		};

		document.addEventListener('pointerdown', handlePointerDown, true);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown, true);
		};
	}, [isFullscreen, panelRef, restore]);
}
