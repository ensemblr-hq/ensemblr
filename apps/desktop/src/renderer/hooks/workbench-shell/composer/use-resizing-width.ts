import { useEffect, useRef, useState } from 'react';

/** How long after the last width change the observed box still counts as resizing. */
const RESIZE_SETTLE_MS = 150;

/**
 * Tracks whether an element's width is still moving, so a caller can reflow its
 * children outright instead of animating them into their new places.
 *
 * Motion measures a laid-out box on every commit and slides whatever moved
 * since the last one, so a render that lands in the same commit as a panel-drag
 * width change reads as a layout change and sets the whole stack sliding — and
 * the next frame retargets it before it lands, which is what leaves rows
 * settling somewhere they were never dragged to.
 *
 * Two limits are worth knowing. `ResizeObserver` reports a change after layout,
 * so the first changed frame of a drag renders before the flag flips. And this
 * window is shorter than `RIGHT_SIDEBAR_SIZE_COMMIT_DELAY_MS` in
 * `hooks/workbench-shell/use-right-sidebar-controller.ts`, which is only safe
 * because that timer's commit moves no geometry — the panel's `defaultSize` is
 * frozen at mount. Un-freezing it makes the two delays a real ordering
 * dependency.
 * @returns The ref for the measured box, and whether its width is still moving
 */
export function useResizingWidth() {
	const boxRef = useRef<HTMLDivElement>(null);
	const [resizing, setResizing] = useState(false);

	useEffect(() => {
		const box = boxRef.current;

		if (!box) {
			return;
		}

		let settleTimer: number | null = null;
		let lastWidth: number | null = null;
		const observer = new ResizeObserver((entries) => {
			const width = entries.at(0)?.contentRect.width;

			if (width === undefined || width === lastWidth) {
				return;
			}

			const isFirstMeasurement = lastWidth === null;
			lastWidth = width;

			if (isFirstMeasurement) {
				return;
			}

			setResizing(true);

			if (settleTimer !== null) {
				window.clearTimeout(settleTimer);
			}

			settleTimer = window.setTimeout(() => {
				settleTimer = null;
				setResizing(false);
			}, RESIZE_SETTLE_MS);
		});

		observer.observe(box);

		return () => {
			observer.disconnect();

			if (settleTimer !== null) {
				window.clearTimeout(settleTimer);
			}
		};
	}, []);

	return { boxRef, resizing };
}
