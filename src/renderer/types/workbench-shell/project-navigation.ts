import type { ReactElement } from 'react';

import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

export interface WorkspaceEntry {
	project: ProjectShellModel;
	workspace: WorkspaceShellModel;
}

export interface ProjectNavigationState {
	collapsedProjectIdSet: Set<string>;
	isProjectReorderLayoutAnimationDisabled: boolean;
	isProjectReorderPositionOnlyLayout: boolean;
	orderedProjects: ProjectShellModel[];
	pinnedWorkspaceEntries: WorkspaceEntry[];
	pinnedWorkspaceIdSet: Set<string>;
	reorderProjects: (reorderedElements: ReactElement[]) => void;
	toggleProjectCollapsed: (projectId: string) => void;
	toggleWorkspacePinned: (workspaceId: string) => void;
}
