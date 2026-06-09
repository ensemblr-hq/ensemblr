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

/** Repository / workspace navigation tree IPC surface. */
export interface NavigationApi {
	repositoryWorkspaceNavigation: () => Promise<RepositoryWorkspaceNavigationSnapshot>;
}
