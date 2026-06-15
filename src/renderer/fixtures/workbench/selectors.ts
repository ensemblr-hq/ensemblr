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

export function findSession(
	workspace: WorkspaceShellModel,
	sessionId?: string,
): SessionTabModel {
	return (
		workspace.sessions.find((session) => session.id === sessionId) ??
		workspace.sessions[0]
	);
}
