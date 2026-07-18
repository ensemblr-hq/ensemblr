import {
	resolveBoardStatus,
	type WorkspaceBoardStatus,
} from '@/renderer/state/workspace';
import type { BoardDrop } from './use-board-drag';

/**
 * The mutation a resolved drop commits: the moved workspace, its new status,
 * and where it lands within the target column.
 */
export interface BoardDropPlan {
	placeAfter: boolean;
	sourceId: string;
	targetCardId: string | null;
	targetStatus: WorkspaceBoardStatus;
}

/**
 * Decides the status change and in-column placement a resolved drop should
 * apply, or null when the drop is a no-op — an unresolvable target, or a drop
 * onto the whitespace of the column the card already lives in.
 * @param drop - The resolved drop describing what moved and where it landed.
 * @param statusByWorkspaceId - Persisted board status keyed by workspace id.
 * @returns The plan to apply, or null when nothing should change.
 */
export function planBoardDrop(
	drop: BoardDrop,
	statusByWorkspaceId: Record<string, WorkspaceBoardStatus>,
): BoardDropPlan | null {
	const targetStatus = drop.targetCardId
		? resolveBoardStatus(statusByWorkspaceId, drop.targetCardId)
		: drop.targetColumnStatus;
	if (!targetStatus) {
		return null;
	}
	const droppedOnColumnWhitespace = drop.targetCardId === null;
	const sourceStatus = resolveBoardStatus(statusByWorkspaceId, drop.sourceId);
	if (droppedOnColumnWhitespace && sourceStatus === targetStatus) {
		return null;
	}
	return {
		placeAfter: drop.edge === 'bottom',
		sourceId: drop.sourceId,
		targetCardId: drop.targetCardId,
		targetStatus,
	};
}
