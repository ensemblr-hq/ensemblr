import { type RefObject, useLayoutEffect } from 'react';
import type { ScrollToBottom, StickToBottomState } from 'use-stick-to-bottom';
import {
	followsNewestAt,
	maxScrollTop,
} from '@/renderer/lib/conversation/viewport';

/**
 * Keeps a conversation pinned to the newest message when the viewport itself
 * changes size — which is what every composer growth does. Queued follow-ups
 * stacking up, the background-tasks notice appearing, a draft wrapping onto a
 * third line: the composer is a `shrink-0` footer under a `flex-1` timeline, so
 * each of those steals height from the transcript rather than adding any to it.
 *
 * use-stick-to-bottom cannot see any of it. It observes the *content* element
 * alone, and the content is exactly as tall as it was — only the window onto it
 * shrank — so its resize path never runs and the newest message slides away
 * under the composer while the lock still reads as armed.
 *
 * Whether to re-pin is decided from geometry rather than from the library's
 * `escapedFromLock`: the height the viewport had a moment ago, against a
 * `scrollHeight` and `scrollTop` the resize did not touch, says exactly whether
 * the user was following the newest message when the composer moved. The flag
 * cannot answer that — the library never clears it on a programmatic scroll, so
 * a conversation re-armed any other way would stop honouring composer resizes
 * for the rest of its life.
 *
 * A user who *had* scrolled away needs nothing done: the viewport loses height
 * at its bottom edge, so what they were reading stays where it was.
 *
 * The end is computed here rather than taken from `state.targetScrollTop`,
 * which answers 0 whenever either of the library's refs has been detached — a
 * teardown racing a resize would scroll the transcript to its top. Re-arming is
 * skipped while the library already reads as locked, so dragging a panel divider
 * does not spawn an animation per frame.
 * @param input - Viewport handles from the stick-to-bottom context
 */
export function useConversationViewportResize({
	scrollRef,
	scrollState,
	scrollToBottom,
}: {
	scrollRef: RefObject<HTMLElement | null>;
	scrollState: StickToBottomState;
	scrollToBottom: ScrollToBottom;
}): void {
	useLayoutEffect(() => {
		const viewport = scrollRef.current;
		if (!viewport) {
			return;
		}

		let previousClientHeight: number | null = null;

		const followNewestAcrossResize = () => {
			const { clientHeight, scrollHeight, scrollTop } = viewport;
			const heightBefore = previousClientHeight;
			previousClientHeight = clientHeight;
			if (heightBefore === null || heightBefore === clientHeight) {
				return;
			}
			if (
				!followsNewestAt({
					clientHeight: heightBefore,
					scrollHeight,
					scrollTop,
				})
			) {
				return;
			}
			// Corrects within the frame the composer grew in; the library's own
			// scroll waits a rAF, which shows one frame of the gap.
			scrollState.scrollTop = maxScrollTop(viewport);
			if (!scrollState.isAtBottom) {
				scrollToBottom({ animation: 'instant' });
			}
		};

		const resizeObserver = new ResizeObserver(followNewestAcrossResize);
		resizeObserver.observe(viewport);

		return () => {
			resizeObserver.disconnect();
		};
	}, [scrollRef, scrollState, scrollToBottom]);
}
