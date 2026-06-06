import { atomWithStorage } from 'jotai/utils';
import type { DockTabId, ReviewPanelTab } from '@/renderer/types/workbench';
import type { ChangesViewMode } from '@/renderer/types/workbench-shell';

const workspaceStorageOptions = { getOnInit: true };

export const orderedProjectIdsAtom = atomWithStorage<string[]>(
	'ensemble_workspace_ordered_project_ids',
	[],
	undefined,
	workspaceStorageOptions,
);

export const collapsedProjectIdsAtom = atomWithStorage<string[]>(
	'ensemble_workspace_collapsed_project_ids',
	[],
	undefined,
	workspaceStorageOptions,
);

export const pinnedWorkspaceIdsAtom = atomWithStorage<string[]>(
	'ensemble_workspace_pinned_workspace_ids',
	[],
	undefined,
	workspaceStorageOptions,
);

export const closedSessionIdsByWorkspaceAtom = atomWithStorage<
	Record<string, string[]>
>(
	'ensemble_workspace_closed_session_ids_by_workspace',
	{},
	undefined,
	workspaceStorageOptions,
);

export const changesViewModeAtom = atomWithStorage<ChangesViewMode>(
	'ensemble_workspace_changes_view_mode',
	'list',
	undefined,
	workspaceStorageOptions,
);

export const rightSidebarCollapsedAtom = atomWithStorage<boolean>(
	'ensemble_workspace_right_sidebar_collapsed',
	false,
	undefined,
	workspaceStorageOptions,
);

export const rightSidebarSizePercentAtom = atomWithStorage<number>(
	'ensemble_workspace_right_sidebar_size_percent',
	34,
	undefined,
	workspaceStorageOptions,
);

export const activeReviewTabByWorkspaceAtom = atomWithStorage<
	Record<string, ReviewPanelTab>
>(
	'ensemble_workspace_active_review_tab_by_workspace',
	{},
	undefined,
	workspaceStorageOptions,
);

export const activeDockTabByWorkspaceAtom = atomWithStorage<
	Record<string, DockTabId>
>(
	'ensemble_workspace_active_dock_tab_by_workspace',
	{},
	undefined,
	workspaceStorageOptions,
);
