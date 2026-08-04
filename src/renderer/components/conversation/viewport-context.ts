import { createContext, type RefObject, use, useMemo } from 'react';

import { anchorRowTop } from '@/renderer/lib/conversation/viewport';

/**
 * The one manoeuvre a conversation publishes to the timeline rows inside it. A
 * row that resizes itself — a tool disclosure opening — hands back the top edge
 * it sat at, and the conversation keeps it there; the scrolling element and the
 * stick-to-bottom lock both stay behind this call.
 */
export interface ConversationViewport {
	holdRowStill: (row: HTMLElement, previousTop: number) => void;
}

const ConversationViewportContext = createContext<ConversationViewport | null>(
	null,
);

/** Publishes a conversation's viewport to the timeline rows rendered inside it. */
export const ConversationViewportProvider =
	ConversationViewportContext.Provider;

/**
 * Read the surrounding conversation viewport.
 * @returns The viewport handle, or null for a row rendered outside a
 *   conversation, where opening it scrolls nothing.
 */
export function useConversationViewport(): ConversationViewport | null {
	return use(ConversationViewportContext);
}

/**
 * Assemble the handle a conversation publishes to the rows inside it, held
 * stable so a streaming transcript does not re-render every row it holds.
 * @param viewportRef - Ref to the conversation's scrolling element
 * @param releaseFollow - Releases its stick-to-bottom lock
 * @returns The value to provide to {@link ConversationViewportProvider}.
 */
export function useConversationViewportValue(
	viewportRef: RefObject<HTMLElement | null>,
	releaseFollow: () => void,
): ConversationViewport {
	return useMemo(
		() => ({
			/**
			 * Hold `row` at `previousTop`, ignoring rows whose conversation has no
			 * scrolling element yet.
			 * @param row - The row that just resized
			 * @param previousTop - Its top edge before the resize
			 */
			holdRowStill: (row: HTMLElement, previousTop: number) => {
				const viewport = viewportRef.current;
				if (viewport === null) {
					return;
				}
				anchorRowTop({ previousTop, releaseFollow, row, viewport });
			},
		}),
		[releaseFollow, viewportRef],
	);
}
