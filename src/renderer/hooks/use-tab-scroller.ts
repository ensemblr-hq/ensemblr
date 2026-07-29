import { useCallback, useEffect, useRef } from 'react';

/** Breathing room kept between a revealed tab and the strip edge, in pixels. */
const TAB_REVEAL_PADDING = 12;

/** Smallest thumb width in pixels, so a crowded strip keeps a grab target. */
const MIN_THUMB_WIDTH = 24;

/** Idle delay before the overlay scrollbar fades back out, in milliseconds. */
const THUMB_HIDE_DELAY_MS = 900;

/**
 * Finds the tab element carrying `key` in its `data-tab-key` attribute. Matching
 * on the dataset value rather than a selector keeps ids that contain CSS-special
 * characters, such as `terminal:abc`, working without escaping.
 * @param viewport - Scrolling element that holds the tab elements
 * @param key - Value the wanted tab publishes as `data-tab-key`
 * @returns The matching tab element, or null when the strip has no such tab
 */
function findTab(viewport: HTMLElement, key: string): HTMLElement | null {
	for (const candidate of viewport.querySelectorAll<HTMLElement>(
		'[data-tab-key]',
	)) {
		if (candidate.dataset.tabKey === key) {
			return candidate;
		}
	}

	return null;
}

/**
 * Scrolls the strip the shortest distance that brings `tab` fully into view,
 * keeping a small gap at the edge so an activated tab never sits flush against
 * it. A tab wider than the viewport can never fit, so it aligns to its leading
 * edge and lets its tail overflow, keeping the icon and label readable.
 * @param viewport - Scrolling element that clips the tab strip
 * @param tab - Tab element to reveal
 * @param behavior - Scroll behavior; `auto` skips the animation on first paint
 */
function alignTabIntoView(
	viewport: HTMLElement,
	tab: HTMLElement,
	behavior: ScrollBehavior,
) {
	const viewportBox = viewport.getBoundingClientRect();
	const tabBox = tab.getBoundingClientRect();
	const padding = Math.max(
		0,
		Math.min(TAB_REVEAL_PADDING, (viewportBox.width - tabBox.width) / 2),
	);
	const outgrowsViewport = tabBox.width > viewportBox.width;
	const leadingGap = tabBox.left - viewportBox.left - padding;
	if (leadingGap < 0 || (outgrowsViewport && leadingGap > 0)) {
		viewport.scrollBy({ behavior, left: leadingGap });
		return;
	}

	const trailingGap = tabBox.right - viewportBox.right + padding;
	if (!outgrowsViewport && trailingGap > 0) {
		viewport.scrollBy({ behavior, left: trailingGap });
	}
}

/**
 * Sizes and positions the thumb from the viewport's current scroll geometry.
 * @param viewport - Scrolling element the thumb represents
 * @param thumb - Overlay scrollbar thumb element
 * @returns Whether the strip actually overflows and needs a scrollbar
 */
function syncThumb(viewport: HTMLElement, thumb: HTMLElement): boolean {
	const overflow = viewport.scrollWidth - viewport.clientWidth;
	if (overflow < 1) {
		return false;
	}

	const width = Math.max(
		MIN_THUMB_WIDTH,
		(viewport.clientWidth * viewport.clientWidth) / viewport.scrollWidth,
	);
	const travel = Math.max(0, viewport.clientWidth - width);
	const offset = Math.min(
		travel,
		Math.max(0, travel * (viewport.scrollLeft / overflow)),
	);
	thumb.style.width = `${width}px`;
	thumb.style.transform = `translateX(${offset}px)`;

	return true;
}

/**
 * Makes the thumb draggable: while the pointer is down, the viewport scrolls by
 * the drag delta scaled up to the strip's overflow, so the thumb tracks the
 * cursor. Reports drag start and end so the caller can hold the scrollbar
 * visible for the whole gesture.
 * @param input - Thumb, its viewport, a drag-state callback, and an abort signal
 */
function attachThumbDrag({
	onDragChange,
	signal,
	thumb,
	viewport,
}: {
	onDragChange: (isDragging: boolean) => void;
	signal: AbortSignal;
	thumb: HTMLElement;
	viewport: HTMLElement;
}) {
	let drag: { pointerX: number; scrollLeft: number } | null = null;

	thumb.addEventListener(
		'pointerdown',
		(event) => {
			event.preventDefault();
			drag = { pointerX: event.clientX, scrollLeft: viewport.scrollLeft };
			thumb.setPointerCapture(event.pointerId);
			onDragChange(true);
		},
		{ signal },
	);
	thumb.addEventListener(
		'pointermove',
		(event) => {
			const travel = viewport.clientWidth - thumb.offsetWidth;
			const overflow = viewport.scrollWidth - viewport.clientWidth;
			if (!drag || travel <= 0 || overflow <= 0) {
				return;
			}
			viewport.scrollLeft =
				drag.scrollLeft + ((event.clientX - drag.pointerX) * overflow) / travel;
		},
		{ signal },
	);
	for (const eventName of ['pointerup', 'pointercancel'] as const) {
		thumb.addEventListener(
			eventName,
			() => {
				drag = null;
				onDragChange(false);
			},
			{ signal },
		);
	}
}

/**
 * Wires the auto-hiding overlay scrollbar to a scrolling tab strip: keeps the
 * thumb in sync with the viewport, reveals it while the user scrolls, hovers, or
 * drags it, and fades it out once all three stop. Also reports every reflow, so
 * the caller can re-reveal the active tab after a resize moves it out of view.
 * @param input - Surfaces of one strip, plus the reflow callback
 * @returns Teardown removing every listener and observer it registered
 */
function attachOverlayScrollbar({
	onReflow,
	thumb,
	viewport,
	wrapper,
}: {
	onReflow: () => void;
	thumb: HTMLElement;
	viewport: HTMLElement;
	wrapper: HTMLElement;
}): () => void {
	const controller = new AbortController();
	const { signal } = controller;
	let hideTimer: ReturnType<typeof setTimeout> | null = null;
	let scrollFrame: number | null = null;
	let isHovered = false;
	let isDragging = false;

	/**
	 * Resizes the thumb, shows it whenever the strip overflows, and queues the
	 * fade-out unless the pointer is still hovering or dragging the strip.
	 */
	const reveal = () => {
		const isOverflowing = syncThumb(viewport, thumb);
		if (hideTimer) {
			clearTimeout(hideTimer);
			hideTimer = null;
		}
		thumb.dataset.visible = isOverflowing ? 'true' : 'false';
		if (!isOverflowing || isHovered || isDragging) {
			return;
		}
		hideTimer = setTimeout(() => {
			thumb.dataset.visible = 'false';
		}, THUMB_HIDE_DELAY_MS);
	};

	/** Tracks hover so the scrollbar stays up while the pointer is over the strip. */
	const setHovered = (hovered: boolean) => {
		isHovered = hovered;
		reveal();
	};

	/** Tracks the thumb drag, which outlives hover once the pointer is captured. */
	const setDragging = (dragging: boolean) => {
		isDragging = dragging;
		reveal();
	};

	/** Coalesces a burst of scroll events into one thumb sync per frame. */
	const queueReveal = () => {
		if (scrollFrame !== null) {
			return;
		}
		scrollFrame = requestAnimationFrame(() => {
			scrollFrame = null;
			reveal();
		});
	};

	viewport.addEventListener('scroll', queueReveal, { signal });
	wrapper.addEventListener('pointerenter', () => setHovered(true), { signal });
	wrapper.addEventListener('pointerleave', () => setHovered(false), { signal });
	attachThumbDrag({ onDragChange: setDragging, signal, thumb, viewport });

	const observer = new ResizeObserver(() => {
		reveal();
		onReflow();
	});
	observer.observe(viewport);
	// Adding or removing a tab leaves the viewport's own box untouched and only
	// widens the content, so the content has to be observed for the strip to
	// notice its own tab count changing.
	if (viewport.firstElementChild) {
		observer.observe(viewport.firstElementChild);
	}

	return () => {
		controller.abort();
		observer.disconnect();
		if (hideTimer) {
			clearTimeout(hideTimer);
		}
		if (scrollFrame !== null) {
			cancelAnimationFrame(scrollFrame);
		}
	};
}

/**
 * Keeps a horizontally scrolling tab strip usable: brings the active tab fully
 * into view whenever it changes or a reflow pushes it out, and drives an
 * auto-hiding overlay scrollbar that costs the strip no layout height.
 * @param activeKey - `data-tab-key` of the active tab, or null when none is active
 * @returns Refs the strip attaches to its wrapper, viewport, and thumb elements
 */
export function useTabScroller(activeKey: string | null) {
	const wrapperRef = useRef<HTMLDivElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const thumbRef = useRef<HTMLDivElement>(null);
	const activeKeyRef = useRef<string | null>(null);

	/**
	 * Reveals whichever tab is currently active, from the tab-change effect and
	 * from every reflow the scrollbar reports.
	 * @param behavior - Scroll behavior to reveal the tab with
	 */
	const alignActiveTab = useCallback((behavior: ScrollBehavior) => {
		const viewport = viewportRef.current;
		const key = activeKeyRef.current;
		if (!(viewport && key)) {
			return;
		}

		const tab = findTab(viewport, key);
		if (tab) {
			alignTabIntoView(viewport, tab, behavior);
		}
	}, []);

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport || !activeKey) {
			return;
		}

		// Animating only reads as movement when the tab being left is still on the
		// strip; first paint and a closed-tab handover jump instead of sliding away
		// from a position that no longer exists.
		const previousKey = activeKeyRef.current;
		const continuesFromAnOpenTab =
			previousKey !== null && findTab(viewport, previousKey) !== null;
		activeKeyRef.current = activeKey;
		alignActiveTab(continuesFromAnOpenTab ? 'smooth' : 'auto');
	}, [activeKey, alignActiveTab]);

	useEffect(() => {
		const wrapper = wrapperRef.current;
		const viewport = viewportRef.current;
		const thumb = thumbRef.current;
		if (!(wrapper && viewport && thumb)) {
			return;
		}

		return attachOverlayScrollbar({
			onReflow: () => alignActiveTab('auto'),
			thumb,
			viewport,
			wrapper,
		});
	}, [alignActiveTab]);

	return { thumbRef, viewportRef, wrapperRef };
}
