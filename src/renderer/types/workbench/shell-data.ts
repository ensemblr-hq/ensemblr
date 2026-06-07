import type {
	HealthSnapshot,
	RepositoryWorkspaceNavigationSnapshot,
	SetupDiagnosticsSnapshot,
} from '@/shared/ipc';

import type { ProjectShellModel } from './project';
import type { WorkspaceShellModel } from './workspace';

export interface WorkbenchShellData {
	hasPreloadBridge: boolean;
	healthError: string | null;
	healthSnapshot: HealthSnapshot | null;
	navigationError: string | null;
	navigationSnapshot: RepositoryWorkspaceNavigationSnapshot | null;
	projects: ProjectShellModel[];
	setupError: string | null;
	setupSnapshot: SetupDiagnosticsSnapshot | null;
}

export interface WorkspaceShellData {
	project: ProjectShellModel;
	workspace: WorkspaceShellModel;
}
