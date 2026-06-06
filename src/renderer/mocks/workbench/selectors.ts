import type {
	ProjectShellModel,
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import { shellFixtureProjects } from './projects';

export function getDefaultProject(): ProjectShellModel {
	return shellFixtureProjects[0];
}

export function getDefaultWorkspace(): WorkspaceShellModel {
	return getDefaultProject().workspaces[0];
}

export function findProject(projectId?: string): ProjectShellModel {
	return (
		shellFixtureProjects.find((project) => project.id === projectId) ??
		getDefaultProject()
	);
}

export function findWorkspace(
	project: ProjectShellModel,
	workspaceId?: string,
): WorkspaceShellModel {
	return (
		project.workspaces.find((workspace) => workspace.id === workspaceId) ??
		project.workspaces[0] ??
		getDefaultWorkspace()
	);
}

export function findSession(
	workspace: WorkspaceShellModel,
	sessionId?: string,
): SessionTabModel {
	return (
		workspace.sessions.find((session) => session.id === sessionId) ??
		workspace.sessions[0]
	);
}
