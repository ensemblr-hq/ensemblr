import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import {
	draggable,
	dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import {
	attachClosestEdge,
	type Edge,
	extractClosestEdge,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { type RefObject, useEffect, useRef, useState } from 'react';

import type { BoardCardKind } from '@/renderer/types/workbench-shell';

/** Drag payload every board card publishes, whichever kind it is. */
export const BOARD_CARD_DRAG_TYPE = 'board-card';

/** What a card's drag hook hands back to the card that mounted it. */
export interface CardDndState {
	closestEdge: Edge | null;
	isDragging: boolean;
	ref: RefObject<HTMLDivElement | null>;
}

/**
 * Wires a board card element as both a drag source and an edge-aware drop
 * target. Workspace and issue cards share one payload shape so either can be
 * dropped onto the other; what that means is decided by `planBoardDrop`, not
 * here.
 *
 * `allowReorder` is false while the board is sorted by anything but the user's
 * own order. The card stays draggable — moving it to another column is a status
 * change the sort has no say over — but it stops reporting an insertion edge,
 * because a line promising "it lands here" is a lie when the sort decides where
 * it lands.
 * @param cardId - Stable id of the card: a workspace id, or an issue key.
 * @param cardKind - Which card shape the id refers to.
 * @param allowReorder - Whether dropping between cards would be honoured.
 * @returns The drag state plus the ref to attach to the card's root element.
 */
export function useCardDnd(
	cardId: string,
	cardKind: BoardCardKind,
	allowReorder: boolean,
): CardDndState {
	const ref = useRef<HTMLDivElement | null>(null);
	const [isDragging, setIsDragging] = useState(false);
	const [closestEdge, setClosestEdge] = useState<Edge | null>(null);

	useEffect(() => {
		const element = ref.current;
		if (!element) {
			return undefined;
		}
		const data = { cardId, cardKind, type: BOARD_CARD_DRAG_TYPE };
		return combine(
			draggable({
				element,
				getInitialData: () => data,
				onDragStart: () => setIsDragging(true),
				onDrop: () => setIsDragging(false),
			}),
			dropTargetForElements({
				canDrop: ({ source }) =>
					source.data.type === BOARD_CARD_DRAG_TYPE &&
					source.data.cardId !== cardId,
				element,
				getData: ({ element: target, input }) =>
					attachClosestEdge(data, {
						allowedEdges: ['top', 'bottom'],
						element: target,
						input,
					}),
				getIsSticky: () => true,
				onDrag: ({ self }) =>
					setClosestEdge(allowReorder ? extractClosestEdge(self.data) : null),
				onDragLeave: () => setClosestEdge(null),
				onDrop: () => setClosestEdge(null),
			}),
		);
	}, [allowReorder, cardId, cardKind]);

	return { closestEdge, isDragging, ref };
}
