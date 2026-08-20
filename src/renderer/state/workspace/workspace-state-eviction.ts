import { atom, type Getter, type Setter, type WritableAtom } from 'jotai';

import {
	activeDockTabByWorkspaceAtom,
	activeReviewTabByWorkspaceAtom,
	changesSourceByWorkspaceAtom,
	continuedMergedPullRequestByWorkspaceAtom,
	dockVisitOrderByWorkspaceAtom,
} from './layout-atoms';
import {
	activeChatTabByWorkspaceAtom,
	sessionVisitOrderByWorkspaceAtom,
} from './selection-atoms';
import {
	pinnedWorkspaceIdsAtom,
	unreadWorkspaceIdsAtom,
	workspaceBoardOrderAtom,
	workspaceBoardStatusAtom,
} from './structure-atoms';
import { viewedChangesByWorkspaceAtom } from './viewed-changes';

/** Decides whether a workspace's entries survive an eviction pass. */
type KeepWorkspace = (workspaceId: string) => boolean;

/**
 * One workspace-keyed store reduced to the single operation eviction needs.
 * Wrapping each atom at declaration keeps the registry below a flat list
 * despite the atoms holding unrelated value types.
 */
interface WorkspaceKeyedStore {
	evict: (get: Getter, set: Setter, keepWorkspace: KeepWorkspace) => void;
}

/** An atom holding one value per workspace id. */
type WorkspaceRecordAtom<Value> = WritableAtom<
	Record<string, Value>,
	[Record<string, Value>],
	void
>;

/** An atom holding a list of workspace ids. */
type WorkspaceIdListAtom = WritableAtom<string[], [string[]], void>;

/**
 * Registers a `workspaceId → value` map for eviction.
 *
 * The write is skipped rather than passed an unchanged value: `atomWithStorage`
 * calls `storage.setItem` on every write regardless of whether the value moved,
 * so writing through would re-serialize each map on every reconcile pass —
 * `viewedChangesByWorkspaceAtom` alone holds up to
 * `MAX_VIEWED_MARKS_PER_WORKSPACE` entries per workspace.
 * @param target - The atom holding the map
 * @returns The store entry for {@link WORKSPACE_KEYED_STORES}
 */
function recordStore<Value>(
	target: WorkspaceRecordAtom<Value>,
): WorkspaceKeyedStore {
	return {
		evict: (get, set, keepWorkspace) => {
			const current = get(target);
			const retained = retainInRecord(current, keepWorkspace);

			if (retained !== current) {
				set(target, retained);
			}
		},
	};
}

/**
 * Registers a list of workspace ids for eviction. Skips an unchanged write for
 * the same reason {@link recordStore} does.
 * @param target - The atom holding the list
 * @returns The store entry for {@link WORKSPACE_KEYED_STORES}
 */
function idListStore(target: WorkspaceIdListAtom): WorkspaceKeyedStore {
	return {
		evict: (get, set, keepWorkspace) => {
			const current = get(target);

			if (!current.every(keepWorkspace)) {
				set(target, current.filter(keepWorkspace));
			}
		},
	};
}

/**
 * Every renderer store keyed by workspace id. Most are persisted, so a
 * workspace that no longer exists would otherwise keep its entry for the
 * lifetime of the install — a fresh install reaches hundreds of dead keys well
 * inside a year. A new workspace-keyed atom belongs on this list, and on the
 * seed/read helpers in `tests/renderer/workspace-state-eviction.test.tsx` that
 * hold this list to its word.
 */
const WORKSPACE_KEYED_STORES: readonly WorkspaceKeyedStore[] = [
	recordStore(activeChatTabByWorkspaceAtom),
	recordStore(sessionVisitOrderByWorkspaceAtom),
	recordStore(activeDockTabByWorkspaceAtom),
	recordStore(activeReviewTabByWorkspaceAtom),
	recordStore(dockVisitOrderByWorkspaceAtom),
	recordStore(changesSourceByWorkspaceAtom),
	recordStore(continuedMergedPullRequestByWorkspaceAtom),
	recordStore(viewedChangesByWorkspaceAtom),
	recordStore(workspaceBoardStatusAtom),
	idListStore(pinnedWorkspaceIdsAtom),
	idListStore(unreadWorkspaceIdsAtom),
	idListStore(workspaceBoardOrderAtom),
];

/**
 * Copies a workspace-keyed map without the entries `keepWorkspace` rejects,
 * returning the input untouched when every entry survives so the caller can
 * skip the write.
 * @param current - The map to filter
 * @param keepWorkspace - Predicate deciding which workspace ids survive
 * @returns The filtered map, or `current` when nothing was dropped
 */
function retainInRecord<Value>(
	current: Record<string, Value>,
	keepWorkspace: KeepWorkspace,
): Record<string, Value> {
	const entries = Object.entries(current);
	const surviving = entries.filter(([workspaceId]) =>
		keepWorkspace(workspaceId),
	);

	return surviving.length === entries.length
		? current
		: Object.fromEntries(surviving);
}

/**
 * Drops every trace of one workspace from the renderer's workspace-keyed state.
 *
 * Call when a workspace is **deleted**, not when it is archived: archiving is
 * reversible from the History screen and the Browse archive dialog, and a
 * workspace that comes back should come back with its board column, its pin and
 * its remembered tabs. {@link pruneWorkspaceStateAtom} is what eventually
 * collects an archived workspace, once it is purged and its row is gone.
 */
export const forgetWorkspaceStateAtom = atom(
	null,
	(get, set, workspaceId: string) => {
		for (const store of WORKSPACE_KEYED_STORES) {
			store.evict(get, set, (candidate) => candidate !== workspaceId);
		}
	},
);

/**
 * Drops entries for every workspace that no longer exists, clearing state
 * stranded by a removal this renderer never saw — one performed before the
 * eviction existed, in another window, or as a purge from the archive.
 *
 * The set must name every workspace still on record, archived included, or an
 * archived workspace loses the state its unarchive is supposed to restore. An
 * empty set is ignored: "nothing loaded yet" and "everything was deleted" look
 * identical here, and guessing wrong wipes the install's preferences.
 */
export const pruneWorkspaceStateAtom = atom(
	null,
	(get, set, existingWorkspaceIds: ReadonlySet<string>) => {
		if (existingWorkspaceIds.size === 0) {
			return;
		}

		for (const store of WORKSPACE_KEYED_STORES) {
			store.evict(get, set, (candidate) => existingWorkspaceIds.has(candidate));
		}
	},
);
