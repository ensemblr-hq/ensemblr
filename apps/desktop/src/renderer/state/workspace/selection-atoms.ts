import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { WorkspaceNavigationRenderState } from '@/renderer/types/workbench';

const workspaceStorageOptions = { getOnInit: true };

/** In-memory cache of the last computed workspace navigation render state. */
export const lastWorkspaceNavigationRenderStateAtom =
	atom<WorkspaceNavigationRenderState | null>(null);

/** localStorage key for the persisted last-selected workspace pair. */
export const LAST_WORKSPACE_SELECTION_STORAGE_KEY =
	'ensemblr_workspace_last_selection';

/** Persisted last-selected (projectId, workspaceId) pair, used as a fallback. */
export const lastWorkspaceSelectionAtom = atomWithStorage<{
	projectId: string;
	workspaceId: string;
} | null>(
	LAST_WORKSPACE_SELECTION_STORAGE_KEY,
	null,
	undefined,
	workspaceStorageOptions,
);

/** localStorage key for the per-workspace chat-tab visit order. */
export const SESSION_VISIT_ORDER_STORAGE_KEY =
	'ensemblr_workspace_session_visit_order_by_workspace';

/**
 * Chat tabs visited, most recent first, keyed by workspace id. Drives where the
 * strip lands when the active tab closes, and which tab a workspace re-opens on
 * when the one it remembers is gone.
 *
 * Persisted, and capped per workspace by `recordTabVisit`. An in-memory chain
 * meant every restart re-entered a workspace with no back-track to honour, so
 * the first close of the run fell through to the neighbour rule — the strip
 * sliding sideways rather than walking back the way the user came.
 */
export const sessionVisitOrderByWorkspaceAtom = atomWithStorage<
	Record<string, string[]>
>(SESSION_VISIT_ORDER_STORAGE_KEY, {}, undefined, workspaceStorageOptions);

/** localStorage key for the per-workspace last-active chat tab. */
export const ACTIVE_CHAT_TAB_STORAGE_KEY =
	'ensemblr_workspace_active_chat_tab_by_workspace';

/**
 * Persisted id of the tab each workspace was last on, so re-entering it lands
 * back there. Any kind qualifies — the strip carries file, diff, and terminal
 * tabs on the same route — so this is a routing memory, never the answer to
 * "which chat should this prompt go to". That target is
 * `resolveTargetChatTabId`.
 */
export const activeChatTabByWorkspaceAtom = atomWithStorage<
	Record<string, string>
>(ACTIVE_CHAT_TAB_STORAGE_KEY, {}, undefined, workspaceStorageOptions);
