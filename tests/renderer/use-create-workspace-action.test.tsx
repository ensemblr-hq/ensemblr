// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { PENDING_WORKSPACE_CREATION_METADATA_KEY } from '../../src/renderer/lib/workbench/optimistic-workspace';
import type { ProjectShellModel } from '../../src/renderer/types/workbench';
import type { RepositoryWorkspaceNavigationSnapshot } from '../../src/shared/ipc/contracts/repository-navigation';
import type { CreateWorkspaceResult } from '../../src/shared/ipc/contracts/workspace';

const {
	createWorkspace,
	invalidateWorkspaceListViews,
	navigate,
	queryClient,
	routerInvalidate,
	toastError,
} = vi.hoisted(() => ({
	createWorkspace: vi.fn(),
	invalidateWorkspaceListViews: vi.fn().mockResolvedValue(undefined),
	navigate: vi.fn().mockResolvedValue(undefined),
	queryClient: {
		setQueryData: vi.fn(),
	},
	routerInvalidate: vi.fn().mockResolvedValue(undefined),
	toastError: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => navigate,
	useRouter: () => ({ invalidate: routerInvalidate }),
}));

vi.mock('sonner', () => ({
	toast: { error: toastError },
}));

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	createWorkspace,
	ensemblrQueryKeys: { repositoryWorkspaceNavigation: () => ['nav'] },
	invalidateWorkspaceListViews,
	isEnsemblrApiAvailable: () => true,
}));

vi.mock('@/renderer/api/query-client', () => ({ queryClient }));

import { useCreateWorkspaceFromProject } from '../../src/renderer/hooks/workbench-shell/navigation-sidebar/use-project-navigation-actions';

let navigationSnapshot: RepositoryWorkspaceNavigationSnapshot | undefined;

const project: ProjectShellModel = {
	id: 'repo-1',
	name: 'Ensemblr',
	owner: { name: 'alice' },
	pathLabel: '/Users/alice/Ensemblr/repos/ensemblr',
	workspaces: [],
};

const baseNavigationSnapshot: RepositoryWorkspaceNavigationSnapshot = {
	generatedAt: '2026-06-06T00:00:00.000Z',
	repositories: [
		{
			createdAt: '2026-06-06T00:00:00.000Z',
			defaultBranch: 'main',
			id: 'repo-1',
			metadata: {},
			name: 'Ensemblr',
			path: '/Users/alice/Ensemblr/repos/ensemblr',
			slug: 'ensemblr',
			updatedAt: '2026-06-06T00:00:00.000Z',
			workspaces: [
				{
					archivedAt: null,
					baseBranch: 'main',
					branchName: 'existing-workspace',
					createdAt: '2026-06-06T00:00:00.000Z',
					id: 'workspace-existing',
					metadata: {},
					name: 'Existing Workspace',
					path: '/Users/alice/Ensemblr/workspaces/ensemblr/existing-workspace',
					repositoryId: 'repo-1',
					slug: 'existing-workspace',
					updatedAt: '2026-06-06T00:00:00.000Z',
				},
			],
		},
	],
};

/** Creates a successful create-workspace IPC result for hook tests. */
function createSuccessResult(): CreateWorkspaceResult {
	return {
		diagnostics: [],
		filesToCopy: null,
		status: 'success',
		workspace: {
			archivedAt: null,
			baseBranch: 'main',
			branchName: 'instant-workspace',
			createdAt: '2026-06-06T00:00:01.000Z',
			id: 'workspace-1',
			metadata: {},
			name: 'Instant Workspace',
			path: '/Users/alice/Ensemblr/workspaces/ensemblr/instant-workspace',
			repositoryId: 'repo-1',
			slug: 'instant-workspace',
			updatedAt: '2026-06-06T00:00:01.000Z',
		},
	};
}

beforeEach(() => {
	navigationSnapshot = structuredClone(baseNavigationSnapshot);
	vi.clearAllMocks();
	queryClient.setQueryData.mockImplementation(
		(_queryKey: unknown, updater: unknown) => {
			if (typeof updater === 'function') {
				const update = updater as (
					current: RepositoryWorkspaceNavigationSnapshot | undefined,
				) => RepositoryWorkspaceNavigationSnapshot | undefined;
				navigationSnapshot = update(navigationSnapshot);
				return navigationSnapshot;
			}

			navigationSnapshot = updater as
				| RepositoryWorkspaceNavigationSnapshot
				| undefined;
			return navigationSnapshot;
		},
	);
});

test('adds a disabled pending workspace before create IPC resolves', async () => {
	let resolveCreate: (result: CreateWorkspaceResult) => void = () => undefined;
	const createResultPromise = new Promise<CreateWorkspaceResult>((resolve) => {
		resolveCreate = resolve;
	});
	createWorkspace.mockReturnValue(createResultPromise);
	const view = renderHook(() => useCreateWorkspaceFromProject());
	let createPromise: Promise<void> = Promise.resolve();

	await act(async () => {
		createPromise = view.result.current.create(project, {
			name: 'Instant Workspace',
		});
	});

	const pendingWorkspace = navigationSnapshot?.repositories[0]?.workspaces[0];
	expect(pendingWorkspace).toMatchObject({
		id: 'pending-workspace-repo-1-1',
		name: 'Instant Workspace',
	});
	expect(
		pendingWorkspace?.metadata[PENDING_WORKSPACE_CREATION_METADATA_KEY],
	).toBe(true);
	expect(view.result.current.creatingProjectIds.has('repo-1')).toBe(true);
	expect(navigate).not.toHaveBeenCalled();

	await act(async () => {
		resolveCreate(createSuccessResult());
		await createPromise;
	});

	expect(navigationSnapshot?.repositories[0]?.workspaces).toMatchObject([
		{
			id: 'workspace-1',
			name: 'Instant Workspace',
		},
		{
			id: 'workspace-existing',
			name: 'Existing Workspace',
		},
	]);
	expect(invalidateWorkspaceListViews).toHaveBeenCalledWith(queryClient);
	expect(navigate).toHaveBeenCalledWith({
		params: {
			projectId: 'repo-1',
			workspaceId: 'workspace-1',
		},
		to: '/projects/$projectId/workspaces/$workspaceId',
	});
	expect(routerInvalidate).toHaveBeenCalledTimes(1);
	expect(view.result.current.creatingProjectIds.has('repo-1')).toBe(false);
});
