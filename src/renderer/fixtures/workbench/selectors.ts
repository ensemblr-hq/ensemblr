import type {
	ProjectShellModel,
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import { shellFixtureProjects } from './projects';

/**
 * Returns the first project from the shell fixtures.
 * @returns The default fixture project
 */
export function getDefaultProject(): ProjectShellModel {
	return shellFixtureProjects[0];
}

/**
 * Returns the first workspace of the default fixture project.
 * @returns The default fixture workspace
 */
export function getDefaultWorkspace(): WorkspaceShellModel {
	return getDefaultProject().workspaces[0];
}

/**
 * Finds a workspace session by id, falling back to the first session.
 * @param workspace - Workspace whose sessions to search
 * @param sessionId - Id of the session to find, if any
 * @returns The matching session, or the first session when none matches
 */
export function findSession(
	workspace: WorkspaceShellModel,
	sessionId?: string,
): SessionTabModel {
	return (
		workspace.sessions.find((session) => session.id === sessionId) ??
		workspace.sessions[0]
	);
}
