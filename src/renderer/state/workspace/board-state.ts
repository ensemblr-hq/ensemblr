import { useAtomValue, useSetAtom } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { useMemo } from 'react';

import { moveToColumnEnd, reorderBoardOrder } from './board-order';
import {
	applyBoardStatus,
	resolveBoardStatus,
	type WorkspaceBoardStatus,
} from './board-status';
import {
	unreadWorkspaceIdsAtom,
	workspaceBoardOrderAtom,
	workspaceBoardStatusAtom,
} from './structure-atoms';

/** Describes a board drop: which workspace moved, where, and relative to what. */
interface BoardReorder {
	placeAfter: boolean;
	sourceId: string;
	statusByWorkspaceId: Record<string, WorkspaceBoardStatus>;
	targetCardId: string | null;
	targetStatus: WorkspaceBoardStatus;
}

/** Stable setters for a workspace's board status, order, and unread state. */
interface WorkspaceBoardActions {
	markWorkspaceRead: (workspaceId: string) => void;
	markWorkspaceUnread: (workspaceId: string) => void;
	reorderBoard: (reorder: BoardReorder) => void;
	setWorkspaceBoardStatus: (
		workspaceId: string,
		status: WorkspaceBoardStatus,
	) => void;
	toggleWorkspaceUnread: (workspaceId: string) => void;
}

/**
 * Returns the full persisted board-status map. Used by the dashboard board to
 * group every workspace into its status column in one subscription.
 * @returns Board status keyed by workspace id.
 */
export function useWorkspaceBoardStatuses(): Record<
	string,
	WorkspaceBoardStatus
> {
	return useAtomValue(workspaceBoardStatusAtom);
}

/**
 * Returns the persisted global board order of workspace ids. Used by the
 * dashboard board to sort cards within each column.
 * @returns Ordered workspace ids.
 */
export function useWorkspaceBoardOrder(): string[] {
	return useAtomValue(workspaceBoardOrderAtom);
}

/**
 * Reads a single workspace's board status, scoped so only rows whose own status
 * changes re-render.
 * @param workspaceId - Workspace whose status to read.
 * @returns The workspace's board status, defaulting when unset.
 */
export function useWorkspaceBoardStatus(
	workspaceId: string,
): WorkspaceBoardStatus {
	const statusAtom = useMemo(
		() =>
			selectAtom(workspaceBoardStatusAtom, (statusByWorkspaceId) =>
				resolveBoardStatus(statusByWorkspaceId, workspaceId),
			),
		[workspaceId],
	);
	return useAtomValue(statusAtom);
}

/**
 * Reads whether a single workspace is marked unread, scoped so only the
 * affected row re-renders on change.
 * @param workspaceId - Workspace whose unread flag to read.
 * @returns True when the workspace is unread.
 */
export function useWorkspaceUnread(workspaceId: string): boolean {
	const unreadAtom = useMemo(
		() =>
			selectAtom(unreadWorkspaceIdsAtom, (workspaceIds) =>
				workspaceIds.includes(workspaceId),
			),
		[workspaceId],
	);
	return useAtomValue(unreadAtom);
}

/**
 * Exposes stable, immutable setters for workspace board status and unread state.
 * Setters never subscribe, so consuming components do not re-render on change.
 * @returns The {@link WorkspaceBoardActions} setter bundle.
 */
export function useWorkspaceBoardActions(): WorkspaceBoardActions {
	const setBoardStatus = useSetAtom(workspaceBoardStatusAtom);
	const setBoardOrder = useSetAtom(workspaceBoardOrderAtom);
	const setUnreadWorkspaceIds = useSetAtom(unreadWorkspaceIdsAtom);

	return useMemo(
		() => ({
			markWorkspaceRead: (workspaceId) =>
				setUnreadWorkspaceIds((workspaceIds) =>
					workspaceIds.includes(workspaceId)
						? workspaceIds.filter((id) => id !== workspaceId)
						: workspaceIds,
				),
			markWorkspaceUnread: (workspaceId) =>
				setUnreadWorkspaceIds((workspaceIds) =>
					workspaceIds.includes(workspaceId)
						? workspaceIds
						: [...workspaceIds, workspaceId],
				),
			reorderBoard: ({
				placeAfter,
				sourceId,
				statusByWorkspaceId,
				targetCardId,
				targetStatus,
			}) =>
				setBoardOrder((order) =>
					targetCardId
						? reorderBoardOrder(order, sourceId, targetCardId, placeAfter)
						: moveToColumnEnd(
								order,
								sourceId,
								targetStatus,
								statusByWorkspaceId,
							),
				),
			setWorkspaceBoardStatus: (workspaceId, status) =>
				setBoardStatus((statusByWorkspaceId) =>
					applyBoardStatus(statusByWorkspaceId, workspaceId, status),
				),
			toggleWorkspaceUnread: (workspaceId) =>
				setUnreadWorkspaceIds((workspaceIds) =>
					workspaceIds.includes(workspaceId)
						? workspaceIds.filter((id) => id !== workspaceId)
						: [...workspaceIds, workspaceId],
				),
		}),
		[setBoardOrder, setBoardStatus, setUnreadWorkspaceIds],
	);
}
