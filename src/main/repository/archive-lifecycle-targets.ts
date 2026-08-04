import type {
	ArchiveLifecycleRepositoryTarget,
	ArchiveLifecycleWorkspaceTarget,
} from '../../shared/ipc/contracts/archive-lifecycle';

/**
 * Workspace + repository identity columns shared by the archive-workspace and
 * unarchive-workspace joins. Per-service row types layer their extra columns
 * on top of this shape.
 */
export interface WorkspaceRepositoryIdentity {
	branchName: string | null;
	id: string;
	name: string;
	path: string;
	repositoryId: string;
	repositoryName: string;
	repositoryPath: string;
	repositorySlug: string;
	slug: string;
}

/**
 * Project a joined workspace row onto the repository and workspace targets that
 * every archive lifecycle stage hands to its subscribers.
 * @param source - Joined workspace + repository row
 * @returns The lifecycle repository and workspace targets, ready to spread into a stage context
 */
export function toLifecycleTargets(source: WorkspaceRepositoryIdentity): {
	repository: ArchiveLifecycleRepositoryTarget;
	workspace: ArchiveLifecycleWorkspaceTarget;
} {
	return {
		repository: {
			id: source.repositoryId,
			name: source.repositoryName,
			path: source.repositoryPath,
			slug: source.repositorySlug,
		},
		workspace: {
			branchName: source.branchName,
			id: source.id,
			name: source.name,
			path: source.path,
			repositoryId: source.repositoryId,
			slug: source.slug,
		},
	};
}
