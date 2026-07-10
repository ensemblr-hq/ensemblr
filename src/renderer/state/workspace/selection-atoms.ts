import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { WorkspaceNavigationRenderState } from '@/renderer/lib/workbench';

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

/** Persisted active chat-tab session id, keyed by workspace id. */
export const activeChatTabByWorkspaceAtom = atomWithStorage<
	Record<string, string>
>(
	'ensemblr_workspace_active_chat_tab_by_workspace',
	{},
	undefined,
	workspaceStorageOptions,
);
