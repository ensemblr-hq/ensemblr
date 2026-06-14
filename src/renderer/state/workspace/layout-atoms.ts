import { atomWithStorage } from 'jotai/utils';
import type { DockTabId, ReviewPanelTab } from '@/renderer/types/workbench';
import type { ChangesViewMode } from '@/renderer/types/workbench-shell';

const workspaceStorageOptions = { getOnInit: true };

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
