import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { DockTabId, ReviewPanelTab } from '@/renderer/types/workbench';
import type {
	ChangesSource,
	ChangesViewMode,
} from '@/renderer/types/workbench-shell';

const workspaceStorageOptions = { getOnInit: true };

/** One-shot request to reveal a directory in the All files tree. */
interface WorkspaceDirectoryRevealRequest {
	id: number;
	path: string;
	workspaceId: string;
}

/** Latest transient request to switch to All files and expand a directory. */
export const workspaceDirectoryRevealRequestAtom =
	atom<WorkspaceDirectoryRevealRequest | null>(null);

/** Persisted display mode for the changes panel (list vs. tree). */
export const changesViewModeAtom = atomWithStorage<ChangesViewMode>(
	'ensemblr_workspace_changes_view_mode',
	'list',
	undefined,
	workspaceStorageOptions,
);

/**
 * Persisted Changes-tab filter source, keyed by workspace id. Absent entries
 * default to "all changes" at the call site.
 */
export const changesSourceByWorkspaceAtom = atomWithStorage<
	Record<string, ChangesSource>
>(
	'ensemblr_workspace_changes_source_by_workspace',
	{},
	undefined,
	workspaceStorageOptions,
);

/** Persisted collapsed state of the workbench right-hand sidebar. */
export const rightSidebarCollapsedAtom = atomWithStorage<boolean>(
	'ensemblr_workspace_right_sidebar_collapsed',
	false,
	undefined,
	workspaceStorageOptions,
);

/** Persisted width of the right-hand sidebar, expressed as a 0-100 percentage. */
export const rightSidebarSizePercentAtom = atomWithStorage<number>(
	'ensemblr_workspace_right_sidebar_size_percent',
	34,
	undefined,
	workspaceStorageOptions,
);

/** Persisted active review-panel tab, keyed by workspace id. */
export const activeReviewTabByWorkspaceAtom = atomWithStorage<
	Record<string, ReviewPanelTab>
>(
	'ensemblr_workspace_active_review_tab_by_workspace',
	{},
	undefined,
	workspaceStorageOptions,
);

/** Persisted active dock-panel tab, keyed by workspace id. */
export const activeDockTabByWorkspaceAtom = atomWithStorage<
	Record<string, DockTabId>
>(
	'ensemblr_workspace_active_dock_tab_by_workspace',
	{},
	undefined,
	workspaceStorageOptions,
);
