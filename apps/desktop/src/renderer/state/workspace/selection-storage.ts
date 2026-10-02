import type { StoredWorkspaceSelection } from '@/renderer/types/workbench';
import {
	ACTIVE_CHAT_TAB_STORAGE_KEY,
	LAST_WORKSPACE_SELECTION_STORAGE_KEY,
	SESSION_VISIT_ORDER_STORAGE_KEY,
} from './selection-atoms';

/**
 * Reads the persisted last-selected workspace pair from localStorage.
 * @returns The stored selection, or `null` when missing/invalid/SSR.
 */
export function readStoredWorkspaceSelection(): StoredWorkspaceSelection | null {
	const selection = readStoredJson(LAST_WORKSPACE_SELECTION_STORAGE_KEY);

	return isStoredWorkspaceSelection(selection) ? selection : null;
}

/**
 * Reads the chat tab a workspace was last on, straight from localStorage. The
 * route loaders run outside React and have no store to read the backing atom
 * from, but they are what chooses the tab a launch or a post-teardown hop lands
 * on — without this they redirect to the synthetic placeholder id and the
 * workspace opens on its first tab whatever it was showing before.
 * @param workspaceId - Workspace whose remembered tab to read
 * @returns The remembered chat tab id, or `null` when none is stored
 */
export function readStoredActiveChatTabId(workspaceId: string): string | null {
	const stored = readStoredJson(ACTIVE_CHAT_TAB_STORAGE_KEY);

	if (typeof stored !== 'object' || stored === null) {
		return null;
	}

	const chatTabId = (stored as Record<string, unknown>)[workspaceId];

	return typeof chatTabId === 'string' && chatTabId ? chatTabId : null;
}

/**
 * Reads a workspace's chat-tab visit order, most recent first, straight from
 * localStorage. The fallback for {@link readStoredActiveChatTabId} on the same
 * out-of-React path: a remembered tab that has since been closed still leaves
 * the chain that says where the user was before it.
 * @param workspaceId - Workspace whose visit order to read
 * @returns The visited tab ids, most recent first, or an empty array
 */
export function readStoredSessionVisitOrder(
	workspaceId: string,
): readonly string[] {
	const stored = readStoredJson(SESSION_VISIT_ORDER_STORAGE_KEY);

	if (typeof stored !== 'object' || stored === null) {
		return [];
	}

	const visitOrder = (stored as Record<string, unknown>)[workspaceId];

	return Array.isArray(visitOrder)
		? visitOrder.filter(
				(tabId): tabId is string => typeof tabId === 'string' && tabId !== '',
			)
		: [];
}

/**
 * Parses one `atomWithStorage` entry from localStorage.
 * @param key - Storage key to read
 * @returns The parsed value, or `null` when missing/invalid/SSR
 */
function readStoredJson(key: string): unknown {
	if (typeof window === 'undefined') {
		return null;
	}

	const raw = window.localStorage.getItem(key);

	if (!raw) {
		return null;
	}

	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return null;
	}
}

/** Type guard for the persisted workspace selection shape. */
function isStoredWorkspaceSelection(
	selection: unknown,
): selection is StoredWorkspaceSelection {
	return (
		typeof selection === 'object' &&
		selection !== null &&
		'projectId' in selection &&
		'workspaceId' in selection &&
		typeof selection.projectId === 'string' &&
		typeof selection.workspaceId === 'string'
	);
}
