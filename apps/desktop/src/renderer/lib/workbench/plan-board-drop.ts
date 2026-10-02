import {
	type BoardSortMode,
	resolveBoardStatus,
	type WorkspaceBoardStatus,
} from '@/renderer/state/workspace';
import type { BoardDrop } from '@/renderer/types/workbench-shell';

/**
 * The mutation a resolved drop commits.
 *
 * A workspace drop moves the card between columns and within one. An issue drop
 * cannot move on its own — an issue leaves Backlog only by producing a
 * workspace — so it opens the assign dialog for the target status, dismisses the
 * issue when dropped on Canceled, or restores a dismissed one back to Backlog.
 */
export type BoardDropPlan =
	| {
			kind: 'move-workspace';
			placeAfter: boolean;
			sourceId: string;
			targetCardId: string | null;
			targetStatus: WorkspaceBoardStatus;
	  }
	| {
			kind: 'assign-issue';
			issueKey: string;
			targetStatus: WorkspaceBoardStatus;
	  }
	| { kind: 'dismiss-issue'; issueKey: string }
	| { kind: 'restore-issue'; issueKey: string };

/**
 * The column a drop landed in. The enclosing column wins whenever the drop
 * carried one, because it is the column the user actually released over; the
 * card's own kind is only a fallback for a drop that resolved no column. An
 * issue card is not evidence of Backlog — a dismissed one sits in Canceled.
 * @param drop - The resolved drop.
 * @param statusByWorkspaceId - Persisted board status keyed by workspace id.
 * @returns The target status, or null when the target is unresolvable.
 */
function resolveTargetStatus(
	drop: BoardDrop,
	statusByWorkspaceId: Record<string, WorkspaceBoardStatus>,
): WorkspaceBoardStatus | null {
	if (drop.targetColumnStatus !== null) {
		return drop.targetColumnStatus;
	}
	if (drop.targetCardId === null) {
		return null;
	}
	return drop.targetCardKind === 'issue'
		? 'backlog'
		: resolveBoardStatus(statusByWorkspaceId, drop.targetCardId);
}

/**
 * Decides what a resolved drop should commit, or null when it is a no-op — an
 * unresolvable target, a workspace dropped back on the whitespace of its own
 * column, or a workspace dropped on Backlog, which holds only issues.
 *
 * Under a non-manual sort a same-column drop is also a no-op: the column is
 * ordered by `updated` or `priority`, so a card dropped between two others would
 * snap straight back and the persisted order would be a lie. Cross-column drops
 * are unaffected — those change status, not order.
 * @param drop - The resolved drop describing what moved and where it landed.
 * @param statusByWorkspaceId - Persisted board status keyed by workspace id.
 * @param sort - The board's active sort; only `manual` honours a reorder.
 * @returns The plan to apply, or null when nothing should change.
 */
export function planBoardDrop(
	drop: BoardDrop,
	statusByWorkspaceId: Record<string, WorkspaceBoardStatus>,
	sort: BoardSortMode = 'manual',
): BoardDropPlan | null {
	const targetStatus = resolveTargetStatus(drop, statusByWorkspaceId);
	if (!targetStatus) {
		return null;
	}

	if (drop.sourceKind === 'issue') {
		if (targetStatus === 'backlog') {
			return { issueKey: drop.sourceId, kind: 'restore-issue' };
		}
		return targetStatus === 'canceled'
			? { issueKey: drop.sourceId, kind: 'dismiss-issue' }
			: { issueKey: drop.sourceId, kind: 'assign-issue', targetStatus };
	}

	if (targetStatus === 'backlog') {
		return null;
	}
	const sourceStatus = resolveBoardStatus(statusByWorkspaceId, drop.sourceId);
	const staysInColumn = sourceStatus === targetStatus;
	if (staysInColumn && (drop.targetCardId === null || sort !== 'manual')) {
		return null;
	}
	return {
		kind: 'move-workspace',
		placeAfter: drop.edge === 'bottom',
		sourceId: drop.sourceId,
		targetCardId: drop.targetCardId,
		targetStatus,
	};
}
