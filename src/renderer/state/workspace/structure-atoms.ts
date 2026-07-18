import { atomWithStorage } from 'jotai/utils';

const workspaceStorageOptions = { getOnInit: true };

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
