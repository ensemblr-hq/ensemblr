/**
 * In-memory mirror of the renderer's kanban board-status map. Board status is
 * renderer-owned state (a Jotai `atomWithStorage` backed by localStorage), so
 * the main process has no source of truth for it. The renderer reports its full
 * map here on startup and on every change; agent-control reads
 * (`getWorkspaceStatus`, `listWorkspaces`) serve from this mirror, and a write
 * (`setWorkspaceStatus`) updates it optimistically before the renderer confirms.
 */
import {
	WORKSPACE_BOARD_STATUSES,
	type WorkspaceBoardStatusValue,
} from '../../shared/agent-control.ts';

/** Status a workspace reads as when it has never been assigned one. */
const DEFAULT_BOARD_STATUS: WorkspaceBoardStatusValue = 'backlog';

const VALID_STATUSES: ReadonlySet<string> = new Set(WORKSPACE_BOARD_STATUSES);

/**
 * Coerces an untrusted value into a valid board status, or null when it is not
 * one of the known statuses.
 * @param value - Reported status value from the renderer.
 * @returns The validated status, or null.
 */
function coerceStatus(value: unknown): WorkspaceBoardStatusValue | null {
	return typeof value === 'string' && VALID_STATUSES.has(value)
		? (value as WorkspaceBoardStatusValue)
		: null;
}

/** Read/write mirror of the renderer's board-status map. */
export interface BoardStatusStore {
	/** Board status for a workspace, defaulting to `backlog` when unset. */
	get: (workspaceId: string) => WorkspaceBoardStatusValue;
	/** Replaces the whole map from a renderer report, dropping invalid entries. */
	replaceAll: (statusByWorkspaceId: Record<string, unknown>) => void;
	/** Sets one workspace's status, ignoring an unknown status value. */
	setOne: (workspaceId: string, status: string) => void;
}

/**
 * Creates the in-memory board-status mirror.
 * @returns A store seeded empty (every workspace reads as `backlog`).
 */
export function createBoardStatusStore(): BoardStatusStore {
	let snapshot: Record<string, WorkspaceBoardStatusValue> = {};

	return {
		get: (workspaceId) => snapshot[workspaceId] ?? DEFAULT_BOARD_STATUS,
		replaceAll: (statusByWorkspaceId) => {
			const next: Record<string, WorkspaceBoardStatusValue> = {};
			for (const [workspaceId, rawStatus] of Object.entries(
				statusByWorkspaceId ?? {},
			)) {
				const status = coerceStatus(rawStatus);
				if (status) {
					next[workspaceId] = status;
				}
			}
			snapshot = next;
		},
		setOne: (workspaceId, status) => {
			const coerced = coerceStatus(status);
			if (!coerced) {
				return;
			}
			snapshot =
				coerced === DEFAULT_BOARD_STATUS
					? Object.fromEntries(
							Object.entries(snapshot).filter(([id]) => id !== workspaceId),
						)
					: { ...snapshot, [workspaceId]: coerced };
		},
	};
}
