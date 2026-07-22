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

/** Status a workspace falls back to when it has no explicit board status. */
export const DEFAULT_BOARD_STATUS: WorkspaceBoardStatus = 'backlog';

/** Human-readable labels for each board status. */
export const BOARD_STATUS_LABELS: Record<WorkspaceBoardStatus, string> = {
	backlog: 'Backlog',
	'in-progress': 'In progress',
	'in-review': 'In review',
	done: 'Done',
	canceled: 'Canceled',
};

/**
 * Resolves a workspace's board status from the persisted status map, applying
 * the default for workspaces that have never been assigned one.
 * @param statusByWorkspaceId - Persisted status map keyed by workspace id.
 * @param workspaceId - Workspace whose status to resolve.
 * @returns The stored status, or {@link DEFAULT_BOARD_STATUS} when absent.
 */
export function resolveBoardStatus(
	statusByWorkspaceId: Record<string, WorkspaceBoardStatus>,
	workspaceId: string,
): WorkspaceBoardStatus {
	return statusByWorkspaceId[workspaceId] ?? DEFAULT_BOARD_STATUS;
}

/**
 * Immutably applies a workspace's board status to the persisted map. Setting the
 * default status removes the key (absence means default), so reads via
 * {@link resolveBoardStatus} stay consistent. Returns the same map reference on a
 * no-op to avoid needless re-renders.
 * @param statusByWorkspaceId - Current persisted status map.
 * @param workspaceId - Workspace whose status to set.
 * @param status - Board status to apply.
 * @returns The next status map (or the same reference when unchanged).
 */
export function applyBoardStatus(
	statusByWorkspaceId: Record<string, WorkspaceBoardStatus>,
	workspaceId: string,
	status: WorkspaceBoardStatus,
): Record<string, WorkspaceBoardStatus> {
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
