import { createContext, type ReactNode, use } from 'react';

import type { WorkspaceNavigationSelection } from '@/renderer/lib/workbench';
import type {
	AddProjectActionId,
	AddProjectMenuModel,
	ProjectShellModel,
	WorkbenchRouteSearch,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type {
	WorkbenchHealth,
	WorkbenchStaticNavigationTarget,
} from '@/renderer/types/workbench-shell';

export interface WorkbenchLayoutModel {
	activeProject: ProjectShellModel | null;
	activeWorkspace: WorkspaceShellModel | null;
	addProjectMenu: AddProjectMenuModel;
	displayProjects: ProjectShellModel[];
	displaySelection: WorkspaceNavigationSelection | null;
	health: WorkbenchHealth;
	navigateToStaticRoute: (target: WorkbenchStaticNavigationTarget) => void;
	navigateToWorkspace: (projectId: string, workspaceId: string) => void;
	onAddProject: (id: AddProjectActionId) => void;
	resolveWorkspaceRouteSearch: (
		workspace: WorkspaceShellModel,
	) => WorkbenchRouteSearch;
}

const WorkbenchLayoutModelContext = createContext<WorkbenchLayoutModel | null>(
	null,
);

export function WorkbenchLayoutModelProvider({
	value,
	children,
}: {
	value: WorkbenchLayoutModel;
	children: ReactNode;
}) {
	return (
		<WorkbenchLayoutModelContext.Provider value={value}>
			{children}
		</WorkbenchLayoutModelContext.Provider>
	);
}

/** Consumes the workbench layout model context; throws when used outside `_shell`. */
export function useWorkbenchLayoutRouteModel(): WorkbenchLayoutModel {
	const model = use(WorkbenchLayoutModelContext);

	if (!model) {
		throw new Error('Workbench layout model is only available below _shell.');
	}

	return model;
}
