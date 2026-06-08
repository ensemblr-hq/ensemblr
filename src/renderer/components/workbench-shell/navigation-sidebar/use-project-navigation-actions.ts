import { useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
	createWorkspace,
	ensembleQueryKeys,
	isEnsembleApiAvailable,
} from '@/renderer/api/ensemble-queries';
import { queryClient } from '@/renderer/api/query-client';
import { pickComposerSurname } from '@/renderer/lib/workbench/workspace-name-pool';
import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { CreateWorkspaceDiagnostic } from '@/shared/ipc';

/**
 * Picks the workspace to surface after archiving, preferring another workspace
 * in the same project before falling back to the first available elsewhere.
 */
function pickFallbackWorkspace({
	archivedWorkspaceId,
	orderedProjects,
	preferredProjectId,
}: {
	archivedWorkspaceId: string;
	orderedProjects: ProjectShellModel[];
	preferredProjectId: string | null;
}): { project: ProjectShellModel; workspace: WorkspaceShellModel } | null {
	if (preferredProjectId) {
		const sameProject = orderedProjects.find(
			(project) => project.id === preferredProjectId,
		);
		const sibling = sameProject?.workspaces.find(
			(workspace) => workspace.id !== archivedWorkspaceId,
		);
		if (sameProject && sibling) {
			return { project: sameProject, workspace: sibling };
		}
	}

	for (const project of orderedProjects) {
		const candidate = project.workspaces.find(
			(workspace) => workspace.id !== archivedWorkspaceId,
		);
		if (candidate) {
			return { project, workspace: candidate };
		}
	}

	return null;
}

interface CreateWorkspaceActionDeps {
	disableProjectReorderLayoutAnimation: () => void;
}

interface CreateWorkspaceActionResult {
	create: (project: ProjectShellModel) => Promise<void>;
	error: string | null;
	isCreating: boolean;
}

/** Creates a workspace, invalidates navigation cache, and routes to it. */
export function useCreateWorkspaceFromProject({
	disableProjectReorderLayoutAnimation,
}: CreateWorkspaceActionDeps): CreateWorkspaceActionResult {
	const navigate = useNavigate();
	const router = useRouter();
	const pendingProjectIds = useRef<Set<string>>(new Set());
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const create = useCallback(
		async (project: ProjectShellModel) => {
			if (!isEnsembleApiAvailable()) {
				return;
			}
			if (pendingProjectIds.current.has(project.id)) {
				return;
			}
			pendingProjectIds.current.add(project.id);
			setIsCreating(true);
			setError(null);

			try {
				const excluded = project.workspaces.flatMap((workspace) => [
					workspace.name,
					workspace.branchName,
				]);
				const name = pickComposerSurname({ exclude: excluded });
				const result = await createWorkspace({
					name,
					repositoryId: project.id,
				});

				if (result.status !== 'success' || !result.workspace) {
					const firstError = result.diagnostics.find(
						(diagnostic: CreateWorkspaceDiagnostic) =>
							diagnostic.severity === 'error',
					);
					const message = firstError?.message ?? 'Failed to create workspace.';
					setError(message);
					toast.error(message);
					return;
				}

				const created = result.workspace;

				// Suppress the parent project's reorder layout animation while the new
				// workspace inflates — otherwise the project height jump triggers a
				// motion artifact across sibling project rows.
				disableProjectReorderLayoutAnimation();

				// Force the navigation snapshot to refetch from SQLite so the new row
				// is authoritative in the cache before any route loader reads it.
				await queryClient.invalidateQueries({
					queryKey: ensembleQueryKeys.repositoryWorkspaceNavigation(),
				});
				await queryClient.refetchQueries({
					queryKey: ensembleQueryKeys.repositoryWorkspaceNavigation(),
				});

				// Re-run every active route loader against the fresh cache so the
				// parent `_workbench` match holds projects that include the new
				// workspace before we navigate to it.
				await router.invalidate();

				// Navigate directly to the workspace index route — the workspace
				// loader resolves through the freshly-loaded parent match.
				await navigate({
					params: {
						projectId: project.id,
						workspaceId: created.id,
					},
					to: '/projects/$projectId/workspaces/$workspaceId',
				});
			} finally {
				pendingProjectIds.current.delete(project.id);
				setIsCreating(false);
			}
		},
		[disableProjectReorderLayoutAnimation, navigate, router],
	);

	return { create, error, isCreating };
}

interface ArchiveWorkspaceActionDeps {
	activeProjectId: string | null;
	activeWorkspaceId: string | null;
	disableProjectReorderLayoutAnimation: () => void;
	orderedProjects: ProjectShellModel[];
}

/** Handles cache invalidation and fallback navigation after a workspace archive. */
export function useArchiveWorkspaceAction({
	activeProjectId,
	activeWorkspaceId,
	disableProjectReorderLayoutAnimation,
	orderedProjects,
}: ArchiveWorkspaceActionDeps) {
	const navigate = useNavigate();
	const router = useRouter();

	return useCallback(
		async (archivedWorkspaceId: string) => {
			// Kill the reorder layout animation BEFORE the parent project row
			// shrinks: motion's auto-layout would otherwise flash the sibling
			// project rows up as the archived workspace's height collapses.
			disableProjectReorderLayoutAnimation();

			// Drop the stale navigation snapshot so the sidebar reflows around
			// the deleted workspace, then re-run the route loaders so the
			// workspace match doesn't keep its now-orphaned loaderData.
			await queryClient.invalidateQueries({
				queryKey: ensembleQueryKeys.repositoryWorkspaceNavigation(),
			});
			await router.invalidate();

			if (activeWorkspaceId !== archivedWorkspaceId) {
				return;
			}

			const fallback = pickFallbackWorkspace({
				archivedWorkspaceId,
				orderedProjects,
				preferredProjectId: activeProjectId,
			});

			if (fallback) {
				await navigate({
					params: {
						projectId: fallback.project.id,
						workspaceId: fallback.workspace.id,
					},
					to: '/projects/$projectId/workspaces/$workspaceId',
				});
				return;
			}

			await navigate({ to: '/' });
		},
		[
			activeProjectId,
			activeWorkspaceId,
			disableProjectReorderLayoutAnimation,
			navigate,
			orderedProjects,
			router,
		],
	);
}

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

			await queryClient.invalidateQueries({
				queryKey: ensembleQueryKeys.repositoryWorkspaceNavigation(),
			});
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
