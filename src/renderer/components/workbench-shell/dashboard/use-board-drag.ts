import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import {
	type Edge,
	extractClosestEdge,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { useEffect } from 'react';

import {
	BOARD_STATUS_ORDER,
	type WorkspaceBoardStatus,
} from '@/renderer/state/workspace';

/** A resolved board drop: the moved card and where it landed. */
export interface BoardDrop {
	edge: Edge | null;
	sourceId: string;
	targetCardId: string | null;
	targetColumnStatus: WorkspaceBoardStatus | null;
}

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

/** Resolves a drop landing on another card, with the closest insertion edge. */
function resolveCardDrop(
	sourceId: string,
	dropTargets: readonly DropTargetData[],
): BoardDrop | null {
	const target = dropTargets.find(
		(entry) => entry.data.type === 'workspace-card',
	);
	if (!target) {
		return null;
	}
	const targetCardId = target.data.workspaceId;
	if (typeof targetCardId !== 'string') {
		return null;
	}
	return {
		edge: extractClosestEdge(target.data),
		sourceId,
		targetCardId,
		targetColumnStatus: null,
	};
}

/** Resolves a drop landing on a column's empty space. */
function resolveColumnDrop(
	sourceId: string,
	dropTargets: readonly DropTargetData[],
): BoardDrop | null {
	const target = dropTargets.find(
		(entry) => entry.data.type === 'board-column',
	);
	const status = target?.data.status;
	if (!isBoardStatus(status)) {
		return null;
	}
	return {
		edge: null,
		sourceId,
		targetCardId: null,
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
	const sourceId = sourceData.workspaceId;
	if (typeof sourceId !== 'string') {
		return null;
	}
	return (
		resolveCardDrop(sourceId, dropTargets) ??
		resolveColumnDrop(sourceId, dropTargets)
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
				canMonitor: ({ source }) => source.data.type === 'workspace-card',
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
