import { type RefObject, useLayoutEffect } from 'react';
import type { StickToBottomState } from 'use-stick-to-bottom';
import {
	maxScrollTop,
	ownsWheelGesture,
	readScrollOffset,
	wouldFollowNewest,
} from '@/renderer/lib/conversation/viewport';
import type { ConversationScrollOffset } from '@/renderer/types/chat';

/**
 * use-stick-to-bottom clamps to one pixel short of the end rather than to the
 * end, so a viewport it has pinned there reads a pixel below where the browser's
 * own clamp would leave it.
 */
const LIBRARY_CLAMP_SLACK_PX = 1;

/**
 * Keeps a conversation the user has scrolled away from exactly where they left
 * it while the turn below them is still being written, and lets a wheel gesture
 * release the stick-to-bottom lock in the first place — without mistaking one
 * aimed at a pane scrolling inside a message for one aimed at the transcript.
 *
 * Three things in use-stick-to-bottom miss this viewport. Its resize handler
 * clamps `scrollTop` to the end of the content without checking whether the user
 * has escaped the lock, so a turn that momentarily shrinks — a fenced block
 * being re-tokenized, a tool card swapping to its result — drags the view down.
 * The same shrink can leave the held position within the library's near-bottom
 * threshold of the new end, which it reads as the user having come back to the
 * newest message, so it re-arms the lock and follows the stream away from what
 * they were reading. And its wheel escape hatch only recognises a scroller whose
 * computed `overflow` is exactly `scroll` or `auto`, while Radix's viewport
 * computes `hidden scroll`, so the hatch never matches and releasing the lock
 * falls to the scroll handler, which ignores a scroll that arrives during a
 * resize.
 *
 * Native scroll anchoring is left alone: it fires a scroll event when it adjusts
 * the offset to hold content still, so the held position tracks it rather than
 * fighting it.
 * @param input - Viewport handles from the stick-to-bottom context
 */
export function useConversationScrollHold({
	contentRef,
	scrollRef,
	scrollState,
	stopScroll,
}: {
	contentRef: RefObject<HTMLElement | null>;
	scrollRef: RefObject<HTMLElement | null>;
	scrollState: StickToBottomState;
	stopScroll: () => void;
}): void {
	useLayoutEffect(() => {
		const viewport = scrollRef.current;
		const content = contentRef.current;
		if (!viewport || !content) {
			return;
		}

		let held: ConversationScrollOffset | null = null;

		const isShrunkOutOfReach = () => {
			if (held === null || held.stuckToBottom) {
				return false;
			}
			const furthest = maxScrollTop(viewport);
			return (
				held.scrollTop > furthest &&
				viewport.scrollTop >= furthest - LIBRARY_CLAMP_SLACK_PX
			);
		};

		const rememberPosition = () => {
			if (isShrunkOutOfReach()) {
				return;
			}
			held = readScrollOffset(viewport);
		};

		const reassertEscape = () => {
			if (held === null || held.stuckToBottom || scrollState.escapedFromLock) {
				return;
			}
			if (wouldFollowNewest(viewport, held.scrollTop)) {
				stopScroll();
			}
		};

		const restorePosition = () => {
			reassertEscape();
			if (
				held === null ||
				held.stuckToBottom ||
				!scrollState.escapedFromLock ||
				scrollState.animation !== undefined ||
				held.scrollTop > maxScrollTop(viewport) ||
				viewport.scrollTop >= held.scrollTop
			) {
				return;
			}
			viewport.scrollTop = held.scrollTop;
		};

		const releaseLock = (event: WheelEvent) => {
			if (
				event.deltaY < 0 &&
				maxScrollTop(viewport) > 0 &&
				!scrollState.animation?.ignoreEscapes &&
				ownsWheelGesture(viewport, event.target, event.deltaY)
			) {
				stopScroll();
			}
		};

		rememberPosition();
		viewport.addEventListener('scroll', rememberPosition, { passive: true });
		viewport.addEventListener('wheel', releaseLock, { passive: true });
		// Registered after the library's own observer, which is attached with the
		// content ref during commit, so this correction lands after its clamp and
		// within the same frame — before anything is painted.
		const resizeObserver = new ResizeObserver(restorePosition);
		resizeObserver.observe(content);

		return () => {
			viewport.removeEventListener('scroll', rememberPosition);
			viewport.removeEventListener('wheel', releaseLock);
			resizeObserver.disconnect();
		};
	}, [contentRef, scrollRef, scrollState, stopScroll]);
}
