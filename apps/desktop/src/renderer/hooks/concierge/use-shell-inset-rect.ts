import { useLayoutEffect, useState } from 'react';

/** Viewport rectangle of the shell's content area, in pixels. */
export interface ShellInsetRect {
	height: number;
	left: number;
	top: number;
	width: number;
}

/** The `SidebarInset` element, which is the shell's `<main>` landmark. */
const INSET_SELECTOR = '[data-slot="sidebar-inset"]';

/**
 * Whether two measurements describe the same rectangle.
 * @param left - The rectangle held, or null before one was measured.
 * @param right - The rectangle just measured.
 * @returns True when nothing moved.
 */
function isSameRect(
	left: ShellInsetRect | null,
	right: ShellInsetRect,
): boolean {
	return (
		left !== null &&
		left.height === right.height &&
		left.left === right.left &&
		left.top === right.top &&
		left.width === right.width
	);
}

/**
 * Tracks the rectangle the shell's content area occupies — everything to the
 * right of the navigation sidebar, which is the central pane plus the right
 * sidebar.
 *
 * Measured rather than derived from the sidebar's CSS variables because the
 * sidebar has three widths (expanded, icon-collapsed, offcanvas) and animates
 * between them; a maximized panel positioned from a variable would be right only
 * at the ends of that transition. A `ResizeObserver` on the element itself is
 * correct through the whole of it.
 *
 * Measured in a layout effect rather than after paint: the frame the user hits
 * Maximize would otherwise render with no rectangle at all, and the panel's
 * fallback covers the whole window — a flash across the sidebar. Equal
 * measurements are dropped, so the observer's callbacks through the sidebar's
 * animation do not each re-render the transcript the panel holds.
 * @returns The rectangle, or null before the element is in the document.
 */
export function useShellInsetRect(enabled: boolean): ShellInsetRect | null {
	const [rect, setRect] = useState<ShellInsetRect | null>(null);

	useLayoutEffect(() => {
		if (!enabled) {
			setRect(null);
			return;
		}
		const element = document.querySelector(INSET_SELECTOR);
		if (!element) {
			return;
		}

		const measure = () => {
			const box = element.getBoundingClientRect();
			const measured: ShellInsetRect = {
				height: box.height,
				left: box.left,
				top: box.top,
				width: box.width,
			};
			setRect((held) => (isSameRect(held, measured) ? held : measured));
		};
		measure();

		const observer = new ResizeObserver(measure);
		observer.observe(element);
		window.addEventListener('resize', measure);
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', measure);
		};
	}, [enabled]);

	return rect;
}
