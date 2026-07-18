import {
	DEFAULT_BOARD_STATUS,
	type WorkspaceBoardStatus,
} from './board-status';

/**
 * Sorts a column's workspace ids by their position in the persisted board
 * order, keeping ids absent from the order in their original relative order.
 * @param order - Persisted global board order of workspace ids.
 * @param columnWorkspaceIds - Ids of the workspaces currently in the column.
 * @returns The column ids sorted for display.
 */
export function orderColumnWorkspaceIds(
	order: string[],
	columnWorkspaceIds: string[],
): string[] {
	const indexById = new Map(order.map((id, index) => [id, index]));
	return [...columnWorkspaceIds].sort(
		(a, b) =>
			(indexById.get(a) ?? Number.POSITIVE_INFINITY) -
			(indexById.get(b) ?? Number.POSITIVE_INFINITY),
	);
}

/**
 * Moves a workspace id next to a target id in the board order, before or after
 * it depending on the drop edge.
 * @param order - Current board order.
 * @param sourceId - Id being moved.
 * @param targetId - Id the source is dropped onto.
 * @param placeAfter - True to insert after the target, false to insert before.
 * @returns The reordered id list.
 */
export function reorderBoardOrder(
	order: string[],
	sourceId: string,
	targetId: string,
	placeAfter: boolean,
): string[] {
	const withoutSource = order.filter((id) => id !== sourceId);
	const targetIndex = withoutSource.indexOf(targetId);
	if (targetIndex === -1) {
		return [...withoutSource, sourceId];
	}
	const insertIndex = placeAfter ? targetIndex + 1 : targetIndex;
	return [
		...withoutSource.slice(0, insertIndex),
		sourceId,
		...withoutSource.slice(insertIndex),
	];
}

/**
 * Moves a workspace id to the end of a target status column in the board order,
 * used when a card is dropped on empty column space rather than another card.
 * @param order - Current board order.
 * @param sourceId - Id being moved.
 * @param targetStatus - Status column the source is dropped into.
 * @param statusByWorkspaceId - Persisted status map for the other ids.
 * @returns The reordered id list.
 */
export function moveToColumnEnd(
	order: string[],
	sourceId: string,
	targetStatus: WorkspaceBoardStatus,
	statusByWorkspaceId: Record<string, WorkspaceBoardStatus>,
): string[] {
	const withoutSource = order.filter((id) => id !== sourceId);
	let insertIndex = 0;
	withoutSource.forEach((id, index) => {
		const status = statusByWorkspaceId[id] ?? DEFAULT_BOARD_STATUS;
		if (status === targetStatus) {
			insertIndex = index + 1;
		}
	});
	return [
		...withoutSource.slice(0, insertIndex),
		sourceId,
		...withoutSource.slice(insertIndex),
	];
}
