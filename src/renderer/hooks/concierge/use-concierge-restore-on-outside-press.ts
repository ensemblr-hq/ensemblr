import { type RefObject, useEffect } from 'react';

/**
 * The layers a portal renders outside the panel's subtree while still belonging
 * to it — the composer's model and thinking pickers, its context menu, the
 * clear confirmation, tooltips, toasts. A press inside one of these is a press
 * inside the Concierge as far as the user is concerned, so it must not read as
 * clicking away.
 */
const PORTAL_LAYER_SELECTOR =
	'[data-radix-popper-content-wrapper],[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[role="tooltip"],[data-sonner-toaster]';

/**
 * Drops a maximized Concierge back to its docked card as soon as the user
 * presses something outside it.
 *
 * Maximized, the panel covers the shell inset but not the navigation sidebar,
 * so picking a workspace there leaves the app on a different screen with the
 * panel still claiming to be maximized — and since the launcher bubble hides
 * whenever the Concierge is open, there is nothing left to press to get back to
 * it. Restoring on the press that navigates away is what keeps that from being
 * a dead end.
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
			if (!panel || !(target instanceof Node) || panel.contains(target)) {
				return;
			}
			if (target instanceof Element && target.closest(PORTAL_LAYER_SELECTOR)) {
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
