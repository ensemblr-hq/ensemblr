import { useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
	createWorkspace,
	ensemblrQueryKeys,
	invalidateWorkspaceListViews,
	isEnsemblrApiAvailable,
} from '@/renderer/api/ensemblr-queries';
import { queryClient } from '@/renderer/api/query-client';
import {
	addPendingWorkspaceToNavigationSnapshot,
	removePendingWorkspaceFromNavigationSnapshot,
	replacePendingWorkspaceInNavigationSnapshot,
} from '@/renderer/lib/workbench/optimistic-workspace';
import type {
	ProjectShellModel,
	WorkspaceCreationSeed,
} from '@/renderer/types/workbench';
import type { RepositoryWorkspaceNavigationSnapshot } from '@/shared/ipc/contracts/repository-navigation';
import type {
	CreateWorkspaceDiagnostic,
	CreateWorkspaceRequest,
	CreateWorkspaceResult,
} from '@/shared/ipc/contracts/workspace';
import { pickComposerSurname } from '@/shared/workspace-name-pool';

/**
 * Returns a callback the browse-archive dialog calls after every successful
 * unarchive or purge. Reuses the navigation cache invalidation + router
 * refresh so the sidebar reflects the updated workspace list immediately.
 */
export function useArchiveBrowseChange() {
	const router = useRouter();
	return useCallback(
		async (_repositoryId: string) => {
			await queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.repositoryWorkspaceNavigation(),
			});
			await router.invalidate();
		},
		[router],
	);
}

/** Dependencies for the create-workspace navigation action hook. */
interface CreateWorkspaceActionDeps {
	disableProjectReorderLayoutAnimation: () => void;
}

/** State and `create` handler exposed by the create-workspace action hook. */
interface CreateWorkspaceActionResult {
	create: (
		project: ProjectShellModel,
		seed?: WorkspaceCreationSeed,
	) => Promise<void>;
	creatingProjectIds: ReadonlySet<string>;
	error: string | null;
	isCreating: boolean;
}

/** Input needed to write a pending workspace row into the navigation cache. */
interface PendingWorkspaceCacheInput {
	id: string;
	name: string;
	projectId: string;
	seed?: WorkspaceCreationSeed;
	timestamp: string;
}

/** Chooses the workspace display name from a seed or the composer-name pool. */
function resolveWorkspaceName(
	project: ProjectShellModel,
	seed?: WorkspaceCreationSeed,
): string {
	const excluded = project.workspaces.flatMap((workspace) => [
		workspace.name,
		workspace.branchName,
	]);

	return seed?.name ?? pickComposerSurname({ exclude: excluded });
}

/** Builds the IPC request for creating a workspace from a project and seed. */
function buildCreateWorkspaceRequest({
	name,
	projectId,
	seed,
}: {
	name: string;
	projectId: string;
	seed?: WorkspaceCreationSeed;
}): CreateWorkspaceRequest {
	return {
		...(seed?.baseBranch ? { baseBranch: seed.baseBranch } : {}),
		...(seed?.branchName ? { branchName: seed.branchName } : {}),
		...(seed?.linkedIssue ? { linkedIssue: seed.linkedIssue } : {}),
		name,
		placeholderName: !seed?.name,
		repositoryId: projectId,
	};
}

/** Adds the pending workspace row that makes the sidebar respond immediately. */
function addPendingWorkspaceToCache({
	id,
	name,
	projectId,
	seed,
	timestamp,
}: PendingWorkspaceCacheInput): void {
	queryClient.setQueryData<RepositoryWorkspaceNavigationSnapshot>(
		ensemblrQueryKeys.repositoryWorkspaceNavigation(),
		(current) =>
			current
				? addPendingWorkspaceToNavigationSnapshot(current, {
						...(seed?.baseBranch ? { baseBranch: seed.baseBranch } : {}),
						...(seed?.branchName ? { branchName: seed.branchName } : {}),
						id,
						name,
						repositoryId: projectId,
						timestamp,
					})
				: current,
	);
}

/** Removes a failed pending workspace from the navigation cache. */
function removePendingWorkspaceFromCache(pendingWorkspaceId: string): void {
	queryClient.setQueryData<RepositoryWorkspaceNavigationSnapshot>(
		ensemblrQueryKeys.repositoryWorkspaceNavigation(),
		(current) =>
			current
				? removePendingWorkspaceFromNavigationSnapshot(
						current,
						pendingWorkspaceId,
					)
				: current,
	);
}

/** Replaces the pending row with the authoritative workspace snapshot. */
function replacePendingWorkspaceInCache(
	pendingWorkspaceId: string,
	result: CreateWorkspaceResult,
): void {
	const workspace = result.workspace;

	if (!workspace) {
		return;
	}

	queryClient.setQueryData<RepositoryWorkspaceNavigationSnapshot>(
		ensemblrQueryKeys.repositoryWorkspaceNavigation(),
		(current) =>
			current
				? replacePendingWorkspaceInNavigationSnapshot(
						current,
						pendingWorkspaceId,
						workspace,
					)
				: current,
	);
}

/** Returns the first user-facing create-workspace error from an IPC result. */
function getCreateWorkspaceFailureMessage(
	result: CreateWorkspaceResult,
): string {
	const firstError = result.diagnostics.find(
		(diagnostic: CreateWorkspaceDiagnostic) => diagnostic.severity === 'error',
	);

	return firstError?.message ?? 'Failed to create workspace.';
}

/** Returns a user-facing message for unexpected create-workspace exceptions. */
function getCreateWorkspaceExceptionMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : 'Failed to create workspace.';
}

/** Returns a project-id set with the provided project marked as creating. */
function addCreatingProjectId(
	current: ReadonlySet<string>,
	projectId: string,
): ReadonlySet<string> {
	return new Set(current).add(projectId);
}

/** Returns a project-id set with the provided project no longer marked creating. */
function removeCreatingProjectId(
	current: ReadonlySet<string>,
	projectId: string,
): ReadonlySet<string> {
	const next = new Set(current);
	next.delete(projectId);
	return next;
}

/** Creates a workspace with an optimistic sidebar row, then routes to the real workspace. */
export function useCreateWorkspaceFromProject({
	disableProjectReorderLayoutAnimation,
}: CreateWorkspaceActionDeps): CreateWorkspaceActionResult {
	const navigate = useNavigate();
	const router = useRouter();
	// Synchronous re-entrancy guard: blocks a double-submit within the same tick
	// before `creatingProjectIds` state has flushed to the render that disables
	// the button. The state mirror below drives the UI; this ref guards the call.
	const pendingProjectIds = useRef<Set<string>>(new Set());
	const pendingWorkspaceIdSequence = useRef(0);
	const [creatingProjectIds, setCreatingProjectIds] = useState<
		ReadonlySet<string>
	>(() => new Set());
	const [error, setError] = useState<string | null>(null);

	const create = useCallback(
		async (project: ProjectShellModel, seed?: WorkspaceCreationSeed) => {
			if (!isEnsemblrApiAvailable()) {
				return;
			}
			if (pendingProjectIds.current.has(project.id)) {
				return;
			}

			const name = resolveWorkspaceName(project, seed);
			pendingWorkspaceIdSequence.current += 1;
			const pendingWorkspaceId = `pending-workspace-${project.id}-${pendingWorkspaceIdSequence.current}`;
			const timestamp = new Date().toISOString();

			pendingProjectIds.current.add(project.id);
			setCreatingProjectIds((current) =>
				addCreatingProjectId(current, project.id),
			);
			setError(null);
			disableProjectReorderLayoutAnimation();
			addPendingWorkspaceToCache({
				id: pendingWorkspaceId,
				name,
				projectId: project.id,
				seed,
				timestamp,
			});

			try {
				const result = await createWorkspace(
					buildCreateWorkspaceRequest({
						name,
						projectId: project.id,
						seed,
					}),
				);

				if (result.status !== 'success' || !result.workspace) {
					removePendingWorkspaceFromCache(pendingWorkspaceId);
					const message = getCreateWorkspaceFailureMessage(result);
					setError(message);
					toast.error(message);
					return;
				}

				const created = result.workspace;
				replacePendingWorkspaceInCache(pendingWorkspaceId, result);
				void invalidateWorkspaceListViews(queryClient).catch(() => undefined);

				try {
					await navigate({
						params: {
							projectId: project.id,
							workspaceId: created.id,
						},
						to: '/projects/$projectId/workspaces/$workspaceId',
					});
					void router.invalidate().catch(() => undefined);
				} catch {
					// The workspace is already created and in the cache; only the
					// post-create route hop failed. The router resolves it on the next
					// navigation, so this must not surface as a create failure.
				}
			} catch (cause) {
				removePendingWorkspaceFromCache(pendingWorkspaceId);
				const message = getCreateWorkspaceExceptionMessage(cause);
				setError(message);
				toast.error(message);
			} finally {
				pendingProjectIds.current.delete(project.id);
				setCreatingProjectIds((current) =>
					removeCreatingProjectId(current, project.id),
				);
			}
		},
		[disableProjectReorderLayoutAnimation, navigate, router],
	);

	return {
		create,
		creatingProjectIds,
		error,
		isCreating: creatingProjectIds.size > 0,
	};
}

/** Dependencies for the archive-workspace navigation action hook. */
interface ArchiveWorkspaceActionDeps {
	activeWorkspaceId: string | null;
	disableProjectReorderLayoutAnimation: () => void;
}

/** Handles cache invalidation and Welcome navigation after a workspace archive. */
export function useArchiveWorkspaceAction({
	activeWorkspaceId,
	disableProjectReorderLayoutAnimation,
}: ArchiveWorkspaceActionDeps) {
	const navigate = useNavigate();
	const router = useRouter();

	return useCallback(
		async (archivedWorkspaceId: string) => {
			// Kill the reorder layout animation BEFORE the parent project row
			// shrinks: motion's auto-layout would otherwise flash the sibling
			// project rows up as the archived workspace's height collapses.
			disableProjectReorderLayoutAnimation();

			if (activeWorkspaceId === archivedWorkspaceId) {
				await navigate({ replace: true, to: '/' });
			}

			// Drop the stale navigation snapshot so the sidebar reflows around
			// the deleted workspace, refresh the global History feed so a mounted
			// History screen updates instantly, then re-run route loaders against
			// the non-workspace route so archived workspaces never render a shell.
			await invalidateWorkspaceListViews(queryClient);
			await router.invalidate();
		},
		[activeWorkspaceId, disableProjectReorderLayoutAnimation, navigate, router],
	);
}

/** Dependencies for the archive-project navigation action hook. */
interface ArchiveProjectActionDeps {
	activeProjectId: string | null;
	disableProjectReorderLayoutAnimation: () => void;
	orderedProjects: ProjectShellModel[];
}

/** Handles cache invalidation and fallback navigation after a project archive. */
export function useArchiveProjectAction({
	activeProjectId,
	disableProjectReorderLayoutAnimation,
	orderedProjects,
}: ArchiveProjectActionDeps) {
	const navigate = useNavigate();
	const router = useRouter();

	return useCallback(
		async (archivedProjectId: string) => {
			disableProjectReorderLayoutAnimation();

			// Refresh both the sidebar navigation snapshot and the global History
			// feed so an archive/delete from the sidebar reflects instantly while
			// the History screen is mounted (mirrors the unarchive path).
			await invalidateWorkspaceListViews(queryClient);
			await router.invalidate();

			if (activeProjectId !== archivedProjectId) {
				return;
			}

			const fallbackProject = orderedProjects.find(
				(project) => project.id !== archivedProjectId,
			);
			const fallbackWorkspace = fallbackProject?.workspaces[0];

			if (fallbackProject && fallbackWorkspace) {
				await navigate({
					params: {
						projectId: fallbackProject.id,
						workspaceId: fallbackWorkspace.id,
					},
					to: '/projects/$projectId/workspaces/$workspaceId',
				});
				return;
			}

			await navigate({ to: '/' });
		},
		[
			activeProjectId,
			disableProjectReorderLayoutAnimation,
			navigate,
			orderedProjects,
			router,
		],
	);
}
