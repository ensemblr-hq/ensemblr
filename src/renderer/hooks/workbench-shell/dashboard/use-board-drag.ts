import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { useEffect } from 'react';

import { BOARD_CARD_DRAG_TYPE } from '@/renderer/components/workbench-shell/dashboard/use-card-dnd';
import {
	BOARD_STATUS_ORDER,
	type WorkspaceBoardStatus,
} from '@/renderer/state/workspace';
import type {
	BoardCardKind,
	BoardDrop,
} from '@/renderer/types/workbench-shell';

/** Drag-and-drop payload carried on a source or drop target. */
type DragData = Record<string | symbol, unknown>;

/** A drop target reduced to the data payload the board reads from it. */
interface DropTargetData {
	data: DragData;
}

/** Narrows an unknown drop-target value to a valid board status. */
function isBoardStatus(value: unknown): value is WorkspaceBoardStatus {
	return (
		typeof value === 'string' &&
		(BOARD_STATUS_ORDER as readonly string[]).includes(value)
	);
}

/** Narrows an unknown drag payload value to a board card kind. */
function isBoardCardKind(value: unknown): value is BoardCardKind {
	return value === 'issue' || value === 'workspace';
}

/** Reads the `{ cardId, cardKind }` pair off a card's drag payload. */
function readCard(data: DragData): { id: string; kind: BoardCardKind } | null {
	return typeof data.cardId === 'string' && isBoardCardKind(data.cardKind)
		? { id: data.cardId, kind: data.cardKind }
		: null;
}

/**
 * Reads the status of the column enclosing the pointer. A card target is nested
 * inside its column's target, so this is set for a card drop too — without it a
 * drop onto a card has to guess the column from the card's kind, and an issue
 * card sits in Canceled once it has been dismissed.
 */
function readColumnStatus(
	dropTargets: readonly DropTargetData[],
): WorkspaceBoardStatus | null {
	const status = dropTargets.find((entry) => entry.data.type === 'board-column')
		?.data.status;
	return isBoardStatus(status) ? status : null;
}

/** Resolves a drop landing on another card, with the closest insertion edge. */
function resolveCardDrop(
	source: { id: string; kind: BoardCardKind },
	dropTargets: readonly DropTargetData[],
): BoardDrop | null {
	const target = dropTargets.find(
		(entry) => entry.data.type === BOARD_CARD_DRAG_TYPE,
	);
	const targetCard = target ? readCard(target.data) : null;
	if (!target || !targetCard) {
		return null;
	}
	return {
		edge: extractClosestEdge(target.data),
		sourceId: source.id,
		sourceKind: source.kind,
		targetCardId: targetCard.id,
		targetCardKind: targetCard.kind,
		targetColumnStatus: readColumnStatus(dropTargets),
	};
}

/** Resolves a drop landing on a column's empty space. */
function resolveColumnDrop(
	source: { id: string; kind: BoardCardKind },
	dropTargets: readonly DropTargetData[],
): BoardDrop | null {
	const status = readColumnStatus(dropTargets);
	if (!status) {
		return null;
	}
	return {
		edge: null,
		sourceId: source.id,
		sourceKind: source.kind,
		targetCardId: null,
		targetCardKind: null,
		targetColumnStatus: status,
	};
}

/**
 * Resolves a drag source and its drop targets into a {@link BoardDrop}, or null
 * when the drop is not actionable. Prefers a card target (reorder / cross-column
 * insert) over the enclosing column target (append to column).
 * @param sourceData - The drag source's data payload.
 * @param dropTargets - The innermost-first drop targets under the pointer.
 * @returns The resolved drop, or null.
 */
export function resolveBoardDrop(
	sourceData: DragData,
	dropTargets: readonly DropTargetData[],
): BoardDrop | null {
	const source = readCard(sourceData);
	if (!source) {
		return null;
	}
	return (
		resolveCardDrop(source, dropTargets) ??
		resolveColumnDrop(source, dropTargets)
	);
}

/**
 * Mounts a single drag monitor for the board and forwards each resolved drop to
 * `onDrop`.
 * @param onDrop - Applies a resolved board drop.
 */
export function useBoardDragMonitor(onDrop: (drop: BoardDrop) => void): void {
	useEffect(
		() =>
			monitorForElements({
				canMonitor: ({ source }) => source.data.type === BOARD_CARD_DRAG_TYPE,
				onDrop: ({ location, source }) => {
					const drop = resolveBoardDrop(
						source.data,
						location.current.dropTargets,
					);
					if (drop) {
						onDrop(drop);
					}
				},
			}),
		[onDrop],
	);
}
