import type {
	RepositoryWorkspaceNavigationSnapshot,
	RepositoryWorkspaceNavigationWorkspace,
} from '@/shared/ipc/contracts/repository-navigation';

/** Metadata key marking a renderer-only workspace row that is still being created. */
export const PENDING_WORKSPACE_CREATION_METADATA_KEY =
	'ensemblrPendingCreation';

/** Inputs needed to build a renderer-only pending workspace row. */
export interface PendingWorkspaceNavigationInput {
	baseBranch?: string;
	branchName?: string;
	id: string;
	name: string;
	repositoryId: string;
	timestamp: string;
}

/** Adds a disabled pending workspace row to the target repository in a navigation snapshot. */
export function addPendingWorkspaceToNavigationSnapshot(
	snapshot: RepositoryWorkspaceNavigationSnapshot,
	input: PendingWorkspaceNavigationInput,
): RepositoryWorkspaceNavigationSnapshot {
	return {
		...snapshot,
		repositories: snapshot.repositories.map((repository) => {
			if (repository.id !== input.repositoryId) {
				return repository;
			}

			return {
				...repository,
				updatedAt: input.timestamp,
				workspaces: [
					createPendingWorkspaceNavigationWorkspace(input),
					...repository.workspaces.filter(
						(workspace) => workspace.id !== input.id,
					),
				],
			};
		}),
	};
}

/** Replaces a pending workspace row with the authoritative row returned by IPC. */
export function replacePendingWorkspaceInNavigationSnapshot(
	snapshot: RepositoryWorkspaceNavigationSnapshot,
	pendingWorkspaceId: string,
	workspace: RepositoryWorkspaceNavigationWorkspace,
): RepositoryWorkspaceNavigationSnapshot {
	return {
		...snapshot,
		repositories: snapshot.repositories.map((repository) => {
			const workspaces = repository.workspaces.filter(
				(candidate) =>
					candidate.id !== pendingWorkspaceId && candidate.id !== workspace.id,
			);

			if (repository.id !== workspace.repositoryId) {
				return { ...repository, workspaces };
			}

			const pendingIndex = repository.workspaces.findIndex(
				(candidate) => candidate.id === pendingWorkspaceId,
			);
			const insertionIndex = pendingIndex >= 0 ? pendingIndex : 0;
			const nextWorkspaces = [...workspaces];
			nextWorkspaces.splice(insertionIndex, 0, workspace);

			return {
				...repository,
				updatedAt: workspace.updatedAt,
				workspaces: nextWorkspaces,
			};
		}),
	};
}

/** Removes a renderer-only pending workspace row from every repository. */
export function removePendingWorkspaceFromNavigationSnapshot(
	snapshot: RepositoryWorkspaceNavigationSnapshot,
	pendingWorkspaceId: string,
): RepositoryWorkspaceNavigationSnapshot {
	return {
		...snapshot,
		repositories: snapshot.repositories.map((repository) => ({
			...repository,
			workspaces: repository.workspaces.filter(
				(workspace) => workspace.id !== pendingWorkspaceId,
			),
		})),
	};
}

/** Builds a navigation-workspace row that is safe to render but not open yet. */
function createPendingWorkspaceNavigationWorkspace({
	baseBranch,
	branchName,
	id,
	name,
	repositoryId,
	timestamp,
}: PendingWorkspaceNavigationInput): RepositoryWorkspaceNavigationWorkspace {
	const slug = toPendingWorkspaceSlug(name);

	return {
		archivedAt: null,
		baseBranch: baseBranch ?? null,
		branchName: branchName ?? slug,
		createdAt: timestamp,
		id,
		metadata: {
			[PENDING_WORKSPACE_CREATION_METADATA_KEY]: true,
		},
		name,
		path: '',
		repositoryId,
		slug,
		updatedAt: timestamp,
	};
}

/** Converts a workspace display name into a temporary renderer-only slug. */
function toPendingWorkspaceSlug(value: string): string {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

	return slug || 'workspace';
}
