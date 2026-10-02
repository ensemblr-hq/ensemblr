import { useEffect } from 'react';

/**
 * Selector for the strip declared a window drag region on the platform this hook
 * runs on. The hook is mounted only inside `WindowTitleBar`, which renders only
 * where Ensemblr draws its own controls (Linux, custom title bar) — and there
 * the title bar is the one draggable strip, since `src/renderer/styles/index.css`
 * gates the toolbar drag regions behind the macOS `inset-window-controls` case.
 * Kept in step with the ungated `-webkit-app-region: drag` rule there, which
 * `tests/renderer/drag-region-double-click.test.tsx` asserts against the
 * stylesheet itself.
 */
export const DRAG_REGION_SELECTOR = '.window-title-bar';

/** Elements inside a drag strip whose own double-click is not a title-bar gesture. */
const INTERACTIVE_SELECTOR =
	'a, button, input, select, textarea, [role="button"]';

/**
 * Toggles maximize when the user double-clicks the title-bar strip.
 *
 * Chromium gives a frameless window the drag behaviour for free but not this,
 * so a Linux user who double-clicks where a title bar would be gets nothing
 * unless the app does it. Listens on the document rather than on each toolbar
 * because the strip is assembled from several headers across the route tree.
 * @param toggle - Toggles the window between maximized and restored.
 */
export function useDragRegionDoubleClick(toggle: () => void): void {
	useEffect(() => {
		const handleDoubleClick = (event: MouseEvent): void => {
			const target = event.target;

			if (!(target instanceof Element) || event.detail !== 2) {
				return;
			}
			if (target.closest(INTERACTIVE_SELECTOR)) {
				return;
			}
			if (!target.closest(DRAG_REGION_SELECTOR)) {
				return;
			}

			clearTextSelection();
			toggle();
		};

		document.addEventListener('dblclick', handleDoubleClick);
		return () => document.removeEventListener('dblclick', handleDoubleClick);
	}, [toggle]);
}

/**
 * Drops the range a double-click leaves behind, so maximizing from a workspace
 * or tab name in the toolbar does not also leave the word highlighted.
 */
function clearTextSelection(): void {
	window.getSelection()?.removeAllRanges();
}
