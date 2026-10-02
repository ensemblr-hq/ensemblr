import {
	WORKSPACE_BOARD_STATUSES,
	type WorkspaceBoardStatusValue,
} from '@/shared/agent-control';

/**
 * The user-assignable board status of a workspace, independent of the runtime
 * {@link WorkspaceStatus} (idle/working/…). Drives the dashboard Kanban columns
 * and the "Set status" context-menu submenu. Derived from the shared
 * agent-control vocabulary so the two stay in lockstep.
 */
export type WorkspaceBoardStatus = WorkspaceBoardStatusValue;

/** Column order for the dashboard board and the status submenu, left to right. */
export const BOARD_STATUS_ORDER: readonly WorkspaceBoardStatus[] =
	WORKSPACE_BOARD_STATUSES;

/**
 * Status a workspace falls back to when it has no explicit board status. A
 * workspace already *is* started work, so it opens in the In progress column
 * rather than the Backlog one, which now holds issues with no workspace yet.
 */
export const DEFAULT_BOARD_STATUS: WorkspaceBoardStatus = 'in-progress';

/**
 * The statuses a workspace may actually hold, i.e. every column except Backlog.
 * Backs the "Set status" submenu so the board's issues-only column cannot be
 * chosen for a workspace.
 */
export const WORKSPACE_BOARD_STATUSES_ASSIGNABLE: readonly WorkspaceBoardStatus[] =
	BOARD_STATUS_ORDER.filter((status) => status !== 'backlog');

/**
 * Narrows a raw board status onto one a workspace may hold. Applied on both read
 * and write because two sources still produce `backlog`: statuses persisted
 * before Backlog became issues-only, and `setWorkspaceStatus` over agent control,
 * whose shared schema still accepts the full vocabulary.
 * @param status - Raw status from storage or an external caller.
 * @returns The status itself, or {@link DEFAULT_BOARD_STATUS} when it is Backlog.
 */
function toAssignableBoardStatus(
	status: WorkspaceBoardStatus,
): WorkspaceBoardStatus {
	return status === 'backlog' ? DEFAULT_BOARD_STATUS : status;
}

/**
 * Resolves a workspace's board status from the persisted status map, applying
 * the default for workspaces that have never been assigned one.
 * @param statusByWorkspaceId - Persisted status map keyed by workspace id.
 * @param workspaceId - Workspace whose status to resolve.
 * @returns The stored status, or {@link DEFAULT_BOARD_STATUS} when absent or Backlog.
 */
export function resolveBoardStatus(
	statusByWorkspaceId: Record<string, WorkspaceBoardStatus>,
	workspaceId: string,
): WorkspaceBoardStatus {
	const stored = statusByWorkspaceId[workspaceId];
	return stored ? toAssignableBoardStatus(stored) : DEFAULT_BOARD_STATUS;
}

/**
 * Immutably applies a workspace's board status to the persisted map. Setting the
 * default status removes the key (absence means default), so reads via
 * {@link resolveBoardStatus} stay consistent. Returns the same map reference on a
 * no-op to avoid needless re-renders.
 * @param statusByWorkspaceId - Current persisted status map.
 * @param workspaceId - Workspace whose status to set.
 * @param requestedStatus - Board status to apply; Backlog lands on the default.
 * @returns The next status map (or the same reference when unchanged).
 */
export function applyBoardStatus(
	statusByWorkspaceId: Record<string, WorkspaceBoardStatus>,
	workspaceId: string,
	requestedStatus: WorkspaceBoardStatus,
): Record<string, WorkspaceBoardStatus> {
	const status = toAssignableBoardStatus(requestedStatus);
	if (status === DEFAULT_BOARD_STATUS) {
		if (!(workspaceId in statusByWorkspaceId)) {
			return statusByWorkspaceId;
		}
		const { [workspaceId]: _removed, ...rest } = statusByWorkspaceId;
		return rest;
	}
	if (statusByWorkspaceId[workspaceId] === status) {
		return statusByWorkspaceId;
	}
	return { ...statusByWorkspaceId, [workspaceId]: status };
}
