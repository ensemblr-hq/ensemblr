import type { HealthSnapshot } from './health';

export interface RepositoryWorkspaceNavigationMetadata {
	[key: string]: unknown;
}

export interface RepositoryWorkspaceNavigationWorkspace {
	archivedAt: string | null;
	baseBranch: string | null;
	branchName: string | null;
	createdAt: string;
	id: string;
	metadata: RepositoryWorkspaceNavigationMetadata;
	name: string;
	path: string;
	repositoryId: string;
	slug: string;
	updatedAt: string;
}

export interface RepositoryWorkspaceNavigationRepository {
	createdAt: string;
	defaultBranch: string | null;
	id: string;
	metadata: RepositoryWorkspaceNavigationMetadata;
	name: string;
	path: string;
	slug: string;
	updatedAt: string;
	workspaces: RepositoryWorkspaceNavigationWorkspace[];
}

export interface RepositoryWorkspaceNavigationSnapshot {
	generatedAt: string;
	repositories: RepositoryWorkspaceNavigationRepository[];
}

/**
 * Single-shot hydration payload sent to the renderer on app start. Bundles the
 * health + navigation snapshots so the first paint can render without a second
 * round-trip.
 */
export interface InitialShellSnapshot {
	capturedAt: string;
	health: HealthSnapshot | null;
	navigation: RepositoryWorkspaceNavigationSnapshot | null;
}

/** Repository / workspace navigation tree IPC surface. */
export interface NavigationApi {
	repositoryWorkspaceNavigation: () => Promise<RepositoryWorkspaceNavigationSnapshot>;
}

/** Window/shell-level IPC surface (resize the BrowserWindow, etc). */
export interface ShellApi {
	ensureWindowWidth: (minimumWidth: number) => Promise<void>;
}
