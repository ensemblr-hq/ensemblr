import { useCallback, useEffect, useRef } from 'react';
import type { PanelImperativeHandle } from 'react-resizable-panels';

/**
 * How many frames a restore may ask the group to seat the rail before it gives
 * up. Two, because an animation frame runs *before* the browser delivers resize
 * observations: the attempt that follows a window change still measures the
 * group the window had before it, and only the next frame sees the width that
 * makes the expansion satisfiable.
 */
const RIGHT_SIDEBAR_RESTORE_FRAME_ATTEMPTS = 2;

/**
 * Asks the group to seat the panel back at `sizePercent`, and reports whether it
 * took. A group still holding the narrow width cannot fit both panels' pixel
 * minimums, and the library answers that by leaving the layout alone rather than
 * by reporting a failure — so the only way to know is to read the panel back.
 * @param panel - Imperative handle for the right-sidebar panel.
 * @param sizePercent - Width to seat the panel at, as a percentage of the group.
 * @returns True once the panel reports itself expanded.
 */
function expandRightSidebarPanel(
	panel: PanelImperativeHandle,
	sizePercent: number,
) {
	panel.expand();
	panel.resize(`${sizePercent}%`);
	return !panel.isCollapsed();
}

/** Starting and dropping a queued right-sidebar restore. */
interface RightSidebarRestore {
	/** Drops a queued restore so a collapse or a teardown cannot be undone by it. */
	cancelRestore: () => void;
	/**
	 * Seats the rail back in the panel, asking again next frame when the group
	 * refused the first attempt, and running `onRestored` only once one took.
	 */
	restore: (onRestored: () => void) => void;
}

/**
 * Owns the animation frame a right-sidebar restore runs in, so the reported
 * collapse state never claims a rail the panel group is still hiding.
 *
 * `expand()` is not transactional: react-resizable-panels answers an expansion
 * it cannot satisfy by leaving the layout alone and reporting nothing, so a
 * restore has to read the panel back and ask again on the next frame. The queued
 * frame lives in a ref rather than a closure because both the click that
 * collapses the rail and the unmount that tears the shell down have to be able
 * to drop a restore somebody else started.
 * @param panelRef - Imperative handle for the right-sidebar panel.
 * @param sizePercentRef - Live width to seat the panel at, read per attempt.
 * @returns The restore starter and its canceller.
 */
export function useRightSidebarRestore(
	panelRef: React.RefObject<PanelImperativeHandle | null>,
	sizePercentRef: React.RefObject<number>,
): RightSidebarRestore {
	const restoreFrameRef = useRef<number | null>(null);
	const cancelRestore = useCallback(() => {
		if (restoreFrameRef.current === null) {
			return;
		}

		window.cancelAnimationFrame(restoreFrameRef.current);
		restoreFrameRef.current = null;
	}, []);
	const restore = useCallback(
		(onRestored: () => void) => {
			let remainingAttempts = RIGHT_SIDEBAR_RESTORE_FRAME_ATTEMPTS;
			const attemptRestore = () => {
				restoreFrameRef.current = null;
				remainingAttempts -= 1;

				const panel = panelRef.current;

				if (panel && expandRightSidebarPanel(panel, sizePercentRef.current)) {
					onRestored();
					return;
				}

				if (remainingAttempts > 0) {
					restoreFrameRef.current =
						window.requestAnimationFrame(attemptRestore);
				}
			};

			cancelRestore();
			restoreFrameRef.current = window.requestAnimationFrame(attemptRestore);
		},
		[cancelRestore, panelRef, sizePercentRef],
	);

	useEffect(() => cancelRestore, [cancelRestore]);

	return { cancelRestore, restore };
}
