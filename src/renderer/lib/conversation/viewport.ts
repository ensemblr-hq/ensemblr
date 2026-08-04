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

/**
 * How far a viewport sits above the end of its own content.
 * @param viewport - The scrolling element
 * @returns Pixels between the visible bottom edge and the end of the content.
 */
function distanceFromBottom(viewport: HTMLElement): number {
	return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
}

/**
 * Whether a viewport sits close enough to its end to count as following the
 * newest message.
 * @param viewport - The scrolling element
 * @returns True while the stream is effectively in view.
 */
function isFollowingNewest(viewport: HTMLElement): boolean {
	return distanceFromBottom(viewport) <= NEAR_BOTTOM_THRESHOLD_PX;
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
