import type { ConversationScrollOffset } from '@/renderer/types/chat';

/**
 * Distance from the bottom that still counts as following the stream. Mirrors
 * use-stick-to-bottom's own `STICK_TO_BOTTOM_OFFSET_PX` so a viewport the
 * library treats as locked is treated as locked here too.
 */
const NEAR_BOTTOM_THRESHOLD_PX = 70;

/**
 * Sub-pixel slack, so a viewport the browser has clamped to its own end is not
 * read as a pixel short of it.
 */
const AT_END_TOLERANCE_PX = 1;

/** Sub-pixel drift is measurement noise, not a row that moved. */
const ANCHOR_DRIFT_TOLERANCE_PX = 1;

/** The computed `overflow-y` values that make an element a scroll container. */
const SCROLLING_OVERFLOW_Y = ['auto', 'scroll'];

/**
 * The computed `overscroll-behavior-y` values that stop a gesture chaining out
 * of an element once it has nothing left to scroll.
 */
const CONTAINING_OVERSCROLL_Y = ['contain', 'none'];

/**
 * How far a viewport sits above the end of its own content.
 * @param viewport - The scrolling element
 * @returns Pixels between the visible bottom edge and the end of the content.
 */
function distanceFromBottom(viewport: HTMLElement): number {
	return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
}

/**
 * The furthest a scrolling element can currently be scrolled. Content that
 * shrinks mid-stream lowers this, which is what puts a position the user chose
 * temporarily out of reach rather than making it wrong.
 * @param element - The scrolling element
 * @returns The largest offset the browser will accept.
 */
export function maxScrollTop(element: Element): number {
	return Math.max(0, element.scrollHeight - element.clientHeight);
}

/**
 * Whether a viewport parked at some offset would count as following the newest
 * message. The offset need not be the current one, so an offset the content has
 * already shrunk past — which the library reads as being at the end, and re-arms
 * its lock for — is recognised as one of these too.
 * @param viewport - The scrolling element
 * @param scrollTop - The offset to judge
 * @returns True when that offset sits within the near-bottom threshold of the end.
 */
export function wouldFollowNewest(
	viewport: HTMLElement,
	scrollTop: number,
): boolean {
	return maxScrollTop(viewport) - scrollTop <= NEAR_BOTTOM_THRESHOLD_PX;
}

/**
 * Whether a viewport sits close enough to its end to count as following the
 * newest message.
 * @param viewport - The scrolling element
 * @returns True while the stream is effectively in view.
 */
function isFollowingNewest(viewport: HTMLElement): boolean {
	return wouldFollowNewest(viewport, viewport.scrollTop);
}

/**
 * Whether an element can still scroll the way a gesture is pushing it.
 * @param element - The scrolling element
 * @param deltaY - How far the gesture scrolls, negative being upwards
 * @returns True when it has content left to reach in that direction.
 */
function hasRoomToScroll(element: Element, deltaY: number): boolean {
	return deltaY < 0
		? element.scrollTop > 0
		: element.scrollTop < maxScrollTop(element);
}

/**
 * Whether a wheel gesture stops at an element rather than chaining out of it. A
 * pane that can still move the way the gesture is pushing takes it; one already
 * at that limit takes it only when its `overscroll-behavior` blocks the chain,
 * and otherwise the gesture passes through to whatever encloses it.
 * @param element - The element to judge
 * @param deltaY - How far the gesture scrolls, negative being upwards
 * @returns True when the gesture goes no further out than here.
 */
function consumesWheel(element: Element, deltaY: number): boolean {
	const style = getComputedStyle(element);
	if (
		!SCROLLING_OVERFLOW_Y.includes(style.overflowY) ||
		element.scrollHeight <= element.clientHeight
	) {
		return false;
	}
	return (
		hasRoomToScroll(element, deltaY) ||
		CONTAINING_OVERSCROLL_Y.includes(style.overscrollBehaviorY)
	);
}

/**
 * Whether a wheel gesture belongs to the conversation viewport itself rather
 * than to a pane scrolling inside it — a tool panel, a code surface, a table.
 * A pane that consumes the gesture leaves the transcript still, so treating one
 * as a transcript scroll would drop the stick-to-bottom lock while nothing
 * moved; a pane the gesture chains out of does move the transcript, and the
 * lock has to go with it.
 *
 * The library's own version of this test reads the `overflow` shorthand, which
 * Radix's viewport computes as `hidden scroll`; matching on `overflow-y` is what
 * makes it recognise this viewport at all.
 * @param viewport - The scrolling element the conversation owns
 * @param target - What the wheel event was dispatched on
 * @param deltaY - How far the gesture scrolls, negative being upwards
 * @returns True when the gesture reaches the viewport rather than stopping inside it.
 */
export function ownsWheelGesture(
	viewport: HTMLElement,
	target: EventTarget | null,
	deltaY: number,
): boolean {
	let element = target instanceof Element ? target : null;
	while (element !== null && element !== viewport) {
		if (consumesWheel(element, deltaY)) {
			return false;
		}
		element = element.parentElement;
	}
	return element === viewport;
}

/**
 * Whether a viewport is parked exactly at the end of its content — as opposed
 * to {@link isFollowingNewest}, which allows the stream a margin. A transcript
 * that still fits its tab is always at its end, having nowhere to scroll.
 * @param viewport - The scrolling element
 * @returns True when there is nothing below the visible area.
 */
function isAtEnd(viewport: HTMLElement): boolean {
	return distanceFromBottom(viewport) <= AT_END_TOLERANCE_PX;
}

/**
 * Pull a row back to the top edge it was measured at before the content around
 * it resized, so a disclosure unfolds under the heading the user clicked.
 *
 * Growth that pushes the end of the transcript out of view releases the
 * stick-to-bottom lock first: left armed, it would read the growth as new
 * output and scroll to the newest message, undoing the correction on the next
 * animation frame.
 * @param input - The scrolling element, the row to hold still, the top edge it sat at before the resize, and the escape hatch out of the stick-to-bottom lock
 */
export function anchorRowTop({
	previousTop,
	releaseFollow,
	row,
	viewport,
}: {
	previousTop: number;
	releaseFollow: () => void;
	row: HTMLElement;
	viewport: HTMLElement;
}): void {
	if (!isAtEnd(viewport)) {
		releaseFollow();
	}
	const drift = row.getBoundingClientRect().top - previousTop;
	if (Math.abs(drift) >= ANCHOR_DRIFT_TOLERANCE_PX) {
		viewport.scrollTop += drift;
	}
}

/**
 * Snapshot a viewport's current position.
 * @param viewport - The scrolling element
 * @returns Its scroll offset, flagged when it is still following the stream.
 */
export function readScrollOffset(
	viewport: HTMLElement,
): ConversationScrollOffset {
	return {
		scrollTop: viewport.scrollTop,
		stuckToBottom: isFollowingNewest(viewport),
	};
}
