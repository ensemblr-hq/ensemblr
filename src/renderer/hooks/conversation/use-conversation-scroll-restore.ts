import { type RefObject, useLayoutEffect, useState } from 'react';
import type { StickToBottomState } from 'use-stick-to-bottom';
import { useConversationScrollOffsets } from '@/renderer/state/conversation-scroll';
import type { ConversationScrollOffset } from '@/renderer/types/chat';

/**
 * Distance from the bottom that still counts as following the stream. Mirrors
 * use-stick-to-bottom's own `STICK_TO_BOTTOM_OFFSET_PX` so a viewport the
 * library treats as locked is remembered as locked too.
 */
const NEAR_BOTTOM_THRESHOLD_PX = 70;

/**
 * Positions a conversation viewport where its tab was last left and keeps that
 * position remembered as the user scrolls, so moving between chat tabs — or
 * workspaces — returns to the same place instead of snapping to the newest
 * message.
 *
 * A viewport left at the bottom stays sticky and follows new output. One left
 * scrolled up is released from the stick-to-bottom lock, so a streaming reply
 * cannot yank the user away from what they came back to read.
 * @param input - Viewport handles from the stick-to-bottom context plus the chat tab id to remember under; omit `scrollKey` to opt out of restoring
 * @returns Whether the viewport is positioned and safe to reveal.
 */
export function useConversationScrollRestore({
	scrollKey,
	scrollRef,
	scrollState,
	stopScroll,
}: {
	scrollKey: string | undefined;
	scrollRef: RefObject<HTMLElement | null>;
	scrollState: StickToBottomState;
	stopScroll: () => void;
}): boolean {
	const offsets = useConversationScrollOffsets();
	const [ready, setReady] = useState(false);

	// Position before the first paint and only reveal the viewport once it
	// lands. The library's own initial scroll fires post-paint, so without this
	// the user briefly sees the top of long conversations on every tab switch.
	useLayoutEffect(() => {
		const viewport = scrollRef.current;
		if (!viewport) {
			setReady(true);
			return;
		}

		const remembered = scrollKey === undefined ? null : offsets.read(scrollKey);
		const restoreScrollTop = resolveRestoreScrollTop(remembered);
		scrollState.scrollTop = restoreScrollTop ?? viewport.scrollHeight;
		if (restoreScrollTop !== null) {
			stopScroll();
		}
		setReady(true);

		if (scrollKey === undefined) {
			return;
		}
		const handleScroll = () => {
			offsets.remember(scrollKey, readScrollOffset(viewport));
		};
		viewport.addEventListener('scroll', handleScroll, { passive: true });
		return () => {
			viewport.removeEventListener('scroll', handleScroll);
		};
	}, [offsets, scrollKey, scrollRef, scrollState, stopScroll]);

	return ready;
}

/**
 * Decide where a viewport should open given what was remembered for its tab.
 * @param offset - The remembered offset, or null for a tab opened for the first time
 * @returns The scroll position to restore, or null to follow the newest message instead.
 */
function resolveRestoreScrollTop(
	offset: ConversationScrollOffset | null,
): number | null {
	if (offset === null || offset.stuckToBottom) {
		return null;
	}
	return offset.scrollTop;
}

/**
 * Snapshot a viewport's current position.
 * @param viewport - The scrolling element
 * @returns Its scroll offset, flagged when it is still following the stream.
 */
function readScrollOffset(viewport: HTMLElement): ConversationScrollOffset {
	const distanceFromBottom =
		viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
	return {
		scrollTop: viewport.scrollTop,
		stuckToBottom: distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX,
	};
}
