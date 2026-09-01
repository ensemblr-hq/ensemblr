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
import { failureDetail, failureText } from '@/renderer/lib/failure-text';
import { i18n } from '@/renderer/lib/i18n';
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

/** How a caller wants the post-create hop handled. */
interface CreateWorkspaceOptions {
	/**
	 * Whether to route to the new workspace. The dashboard board opts out: an
	 * issue drag is a triage gesture, and yanking the user into the workspace
	 * would cost them the board position they were working through.
	 */
	navigate?: boolean;
}

/** State and `create` handler exposed by the create-workspace action hook. */
interface CreateWorkspaceActionResult {
	/** Creates the workspace and resolves with its id, or null when creation failed. */
	create: (
		project: ProjectShellModel,
		seed?: WorkspaceCreationSeed,
		options?: CreateWorkspaceOptions,
	) => Promise<string | null>;
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
		...(seed?.branchPlan ? { branchPlan: seed.branchPlan } : {}),
		...(seed?.linkedIssue ? { linkedIssue: seed.linkedIssue } : {}),
		name,
		placeholderName: !seed?.name,
		repositoryId: projectId,
	};
}

/**
 * The branch the optimistic sidebar row should show before the real snapshot
 * lands: an adopted branch is already known by name, while a branch about to be
 * cut is not named until the service allocates the workspace slug.
 * @param seed - The creation seed, when the workspace came from a source.
 * @returns The branch name to display, or undefined when it is not known yet.
 */
function pendingBranchName(seed?: WorkspaceCreationSeed): string | undefined {
	if (seed?.branchPlan?.kind === 'adopt') {
		return seed.branchPlan.branch;
	}
	return seed?.branchName;
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
						...(pendingBranchName(seed)
							? { branchName: pendingBranchName(seed) }
							: {}),
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

/**
 * Returns the first user-facing create-workspace error from an IPC result, as
 * the translated sentence for its code plus the detail main built for it.
 *
 * Main cannot reach the renderer's i18n instance, so what it sends is a stable
 * code alongside an English sentence. `failureText` turns the code into the
 * app's language and falls back to that English only for a code this build's
 * table does not carry, while `failureDetail` keeps main's sentence as a second
 * line only when it carries specifics a code cannot — the occupied path, git's
 * stderr — rather than restating the headline in a language the reader may not
 * have.
 * @param result - The create-workspace result to report.
 * @returns The headline to show, plus the detail line when there is one.
 */
function getCreateWorkspaceFailure(result: CreateWorkspaceResult): {
	detail: string | undefined;
	title: string;
} {
	const firstError = result.diagnostics.find(
		(diagnostic: CreateWorkspaceDiagnostic) => diagnostic.severity === 'error',
	);
	return {
		detail: firstError
			? (failureDetail(i18n.t, firstError) ?? undefined)
			: undefined,
		title:
			failureText(i18n.t, firstError) ??
			i18n.t(
				'errors:workspace-create.failed.title',
				'Failed to create workspace.',
			),
	};
}

/**
 * Settles the optimistic sidebar row against what the service actually did.
 *
 * A reused workspace was never created: the list already holds it, so replacing
 * the placeholder with it would show the same workspace twice. The placeholder
 * is dropped instead, and the toast says why the request landed somewhere the
 * user did not name.
 * @param pendingWorkspaceId - Id of the optimistic row to settle.
 * @param result - The successful create-workspace result.
 */
function settlePendingWorkspace(
	pendingWorkspaceId: string,
	result: CreateWorkspaceResult,
): void {
	if (!result.reusedExisting) {
		replacePendingWorkspaceInCache(pendingWorkspaceId, result);
		return;
	}
	removePendingWorkspaceFromCache(pendingWorkspaceId);
	toast.info(
		i18n.t(
			'workbench:create-workspace.opened-existing',
			'Opened the workspace that already has this branch checked out.',
		),
	);
}

/** Returns a user-facing message for unexpected create-workspace exceptions. */
function getCreateWorkspaceExceptionMessage(cause: unknown): string {
	return cause instanceof Error
		? cause.message
		: i18n.t(
				'errors:workspace-create.failed.title',
				'Failed to create workspace.',
			);
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

/**
 * Creates a workspace with an optimistic sidebar row, then routes to the real
 * workspace. Resolves with the new workspace's id so a caller that has follow-up
 * work for it — the dashboard board sets its column — can act on the result.
 */
export function useCreateWorkspaceFromProject(): CreateWorkspaceActionResult {
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
		async (
			project: ProjectShellModel,
			seed?: WorkspaceCreationSeed,
			options?: CreateWorkspaceOptions,
		): Promise<string | null> => {
			if (!isEnsemblrApiAvailable()) {
				return null;
			}
			if (pendingProjectIds.current.has(project.id)) {
				return null;
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
					const { detail, title } = getCreateWorkspaceFailure(result);
					setError(title);
					toast.error(title, { description: detail });
					return null;
				}

				const created = result.workspace;
				settlePendingWorkspace(pendingWorkspaceId, result);
				void invalidateWorkspaceListViews(queryClient).catch(() => undefined);

				if (options?.navigate === false) {
					void router.invalidate().catch(() => undefined);
					return created.id;
				}

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
				return created.id;
			} catch (cause) {
				removePendingWorkspaceFromCache(pendingWorkspaceId);
				const message = getCreateWorkspaceExceptionMessage(cause);
				setError(message);
				toast.error(message);
				return null;
			} finally {
				pendingProjectIds.current.delete(project.id);
				setCreatingProjectIds((current) =>
					removeCreatingProjectId(current, project.id),
				);
			}
		},
		[navigate, router],
	);

	return {
		create,
		creatingProjectIds,
		error,
		isCreating: creatingProjectIds.size > 0,
	};
}

/**
 * Refreshes the workspace list caches after a project is deleted, and sends the
 * user to Welcome when the deleted project is the one currently on screen.
 * @returns A callback to invoke with the id of the project that was removed.
 */
export function useDeleteProjectAction({
	activeProjectId,
}: {
	activeProjectId: string | null;
}) {
	const navigate = useNavigate();
	const router = useRouter();

	return useCallback(
		async (removedProjectId: string) => {
			// Refresh both the sidebar navigation snapshot and the global History
			// feed so a delete from the sidebar reflects instantly while the History
			// screen is mounted (mirrors the unarchive path).
			await invalidateWorkspaceListViews(queryClient);
			await router.invalidate();

			if (activeProjectId !== removedProjectId) {
				return;
			}

			// Welcome sticks only because the persisted selection still names the
			// archived project, which the index loader treats as a hard stop;
			// clearing that key here would redirect into an unrelated project.
			await navigate({ replace: true, to: '/' });
		},
		[activeProjectId, navigate, router],
	);
}
