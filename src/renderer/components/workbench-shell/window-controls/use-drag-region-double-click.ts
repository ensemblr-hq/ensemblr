import { useEffect } from 'react';

/**
 * Selectors for the strips declared as window drag regions in
 * `src/renderer/styles/index.css`. Kept in step with the `-webkit-app-region:
 * drag` rule there — a strip that drags the window but is missing here simply
 * will not toggle on a double-click.
 */
const DRAG_REGION_SELECTOR =
	'.native-toolbar, .window-drag-region, .window-chrome-spacer';

/**
 * Toggles maximize when the user double-clicks the title-bar strip.
 *
 * Chromium gives a frameless window the drag behaviour for free but not this,
 * so a Linux user who double-clicks where a title bar would be gets nothing
 * unless the app does it. Listens on the document rather than on each toolbar
 * because the strip is assembled from several headers across the route tree.
 * @param toggle - Toggles the window between maximized and restored.
 * @param enabled - False when the desktop draws the title bar and owns the gesture.
 */
export function useDragRegionDoubleClick(
	toggle: () => void,
	enabled: boolean,
): void {
	useEffect(() => {
		if (!enabled) {
			return;
		}

		const handleDoubleClick = (event: MouseEvent): void => {
			const target = event.target;

			if (!(target instanceof Element) || event.detail !== 2) {
				return;
			}
			if (
				target.closest('a, button, input, select, textarea, [role="button"]')
			) {
				return;
			}
			if (!target.closest(DRAG_REGION_SELECTOR)) {
				return;
			}

			toggle();
		};

		document.addEventListener('dblclick', handleDoubleClick);
		return () => document.removeEventListener('dblclick', handleDoubleClick);
	}, [enabled, toggle]);
}
