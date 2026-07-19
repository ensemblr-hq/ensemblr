import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

import type { WorkspaceBoardStatus } from './board-status';

const workspaceStorageOptions = { getOnInit: true };

/**
 * Window during which project-row layout animation stays suppressed after a
 * reflow-inducing change, long enough to outlast one sidebar reflow.
 */
const PROJECT_REORDER_LAYOUT_ANIMATION_SUPPRESS_MS = 180;

/** Transient suppression state for project-row layout animation. */
const projectReorderLayoutAnimationStateAtom = atom({
	isDisabled: false,
	revision: 0,
});

/** Whether project-row layout animation is currently suppressed. */
export const isProjectReorderLayoutAnimationDisabledAtom = atom(
	(get) => get(projectReorderLayoutAnimationStateAtom).isDisabled,
);

/** Suppresses project-row layout animation long enough for one sidebar reflow. */
export const disableProjectReorderLayoutAnimationAtom = atom(
	null,
	(get, set) => {
		const revision = get(projectReorderLayoutAnimationStateAtom).revision + 1;
		set(projectReorderLayoutAnimationStateAtom, {
			isDisabled: true,
			revision,
		});
		setTimeout(() => {
			set(projectReorderLayoutAnimationStateAtom, (current) =>
				current.revision === revision
					? { isDisabled: false, revision }
					: current,
			);
		}, PROJECT_REORDER_LAYOUT_ANIMATION_SUPPRESS_MS);
	},
);

/** Persisted user-defined ordering of project ids in the workspace sidebar. */
export const orderedProjectIdsAtom = atomWithStorage<string[]>(
	'ensemblr_workspace_ordered_project_ids',
	[],
	undefined,
	workspaceStorageOptions,
);

/** Persisted set of project ids whose workspace group is collapsed. */
export const collapsedProjectIdsAtom = atomWithStorage<string[]>(
	'ensemblr_workspace_collapsed_project_ids',
	[],
	undefined,
	workspaceStorageOptions,
);

/** Persisted set of pinned workspace ids surfaced at the top of the sidebar. */
export const pinnedWorkspaceIdsAtom = atomWithStorage<string[]>(
	'ensemblr_workspace_pinned_workspace_ids',
	[],
	undefined,
	workspaceStorageOptions,
);

/** Persisted board status per workspace, backing the dashboard Kanban columns. */
export const workspaceBoardStatusAtom = atomWithStorage<
	Record<string, WorkspaceBoardStatus>
>('ensemblr_workspace_board_status', {}, undefined, workspaceStorageOptions);

/** Persisted set of workspace ids marked unread (manually or on turn finish). */
export const unreadWorkspaceIdsAtom = atomWithStorage<string[]>(
	'ensemblr_workspace_unread_ids',
	[],
	undefined,
	workspaceStorageOptions,
);

/** Persisted global order of workspace ids on the dashboard board. */
export const workspaceBoardOrderAtom = atomWithStorage<string[]>(
	'ensemblr_workspace_board_order',
	[],
	undefined,
	workspaceStorageOptions,
);
