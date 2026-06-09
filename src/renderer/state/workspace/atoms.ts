import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { WorkspaceNavigationRenderState } from '@/renderer/lib/workbench';
import type { DockTabId, ReviewPanelTab } from '@/renderer/types/workbench';
import type { ChangesViewMode } from '@/renderer/types/workbench-shell';

const workspaceStorageOptions = { getOnInit: true };

/** In-memory cache of the last computed workspace navigation render state. */
export const lastWorkspaceNavigationRenderStateAtom =
	atom<WorkspaceNavigationRenderState | null>(null);

/** localStorage key for the persisted last-selected workspace pair. */
export const LAST_WORKSPACE_SELECTION_STORAGE_KEY =
	'ensemble_workspace_last_selection';

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

/** Persisted user-defined ordering of project ids in the workspace sidebar. */
export const orderedProjectIdsAtom = atomWithStorage<string[]>(
	'ensemble_workspace_ordered_project_ids',
	[],
	undefined,
	workspaceStorageOptions,
);

/** Persisted set of project ids whose workspace group is collapsed. */
export const collapsedProjectIdsAtom = atomWithStorage<string[]>(
	'ensemble_workspace_collapsed_project_ids',
	[],
	undefined,
	workspaceStorageOptions,
);

/** Persisted set of pinned workspace ids surfaced at the top of the sidebar. */
export const pinnedWorkspaceIdsAtom = atomWithStorage<string[]>(
	'ensemble_workspace_pinned_workspace_ids',
	[],
	undefined,
	workspaceStorageOptions,
);

/** Persisted display mode for the changes panel (list vs. tree). */
export const changesViewModeAtom = atomWithStorage<ChangesViewMode>(
	'ensemble_workspace_changes_view_mode',
	'list',
	undefined,
	workspaceStorageOptions,
);

/** Persisted collapsed state of the workbench right-hand sidebar. */
export const rightSidebarCollapsedAtom = atomWithStorage<boolean>(
	'ensemble_workspace_right_sidebar_collapsed',
	false,
	undefined,
	workspaceStorageOptions,
);

/** Persisted width of the right-hand sidebar, expressed as a 0-100 percentage. */
export const rightSidebarSizePercentAtom = atomWithStorage<number>(
	'ensemble_workspace_right_sidebar_size_percent',
	34,
	undefined,
	workspaceStorageOptions,
);

/** Persisted active review-panel tab, keyed by workspace id. */
export const activeReviewTabByWorkspaceAtom = atomWithStorage<
	Record<string, ReviewPanelTab>
>(
	'ensemble_workspace_active_review_tab_by_workspace',
	{},
	undefined,
	workspaceStorageOptions,
);

/** Persisted active dock-panel tab, keyed by workspace id. */
export const activeDockTabByWorkspaceAtom = atomWithStorage<
	Record<string, DockTabId>
>(
	'ensemble_workspace_active_dock_tab_by_workspace',
	{},
	undefined,
	workspaceStorageOptions,
);

/** Persisted active chat-tab session id, keyed by workspace id. */
export const activeChatTabByWorkspaceAtom = atomWithStorage<
	Record<string, string>
>(
	'ensemble_workspace_active_chat_tab_by_workspace',
	{},
	undefined,
	workspaceStorageOptions,
);

/** Persisted Pi model selection keyed by workspace id (survives reloads). */
export const selectedPiModelByWorkspaceAtom = atomWithStorage<
	Record<string, string>
>(
	'ensemble_workspace_selected_pi_model_by_workspace',
	{},
	undefined,
	workspaceStorageOptions,
);

/** Persisted Pi thinking-level selection keyed by workspace id. */
export const selectedPiThinkingLevelByWorkspaceAtom = atomWithStorage<
	Record<string, string>
>(
	'ensemble_workspace_selected_pi_thinking_by_workspace',
	{},
	undefined,
	workspaceStorageOptions,
);
