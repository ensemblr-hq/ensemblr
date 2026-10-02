import { beforeEach, expect, test, vi } from 'vitest';

const { createWorkspace, navigate, queryClient } = vi.hoisted(() => ({
	createWorkspace: vi.fn(),
	navigate: vi.fn(),
	queryClient: {
		fetchQuery: vi.fn(),
		invalidateQueries: vi.fn(),
	},
}));

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	createWorkspace,
	repositoryWorkspaceNavigationQuery: { queryKey: ['navigation'] },
}));

vi.mock('@/renderer/api/query-client', () => ({ queryClient }));

import { seedFirstWorkspace } from '../../src/renderer/lib/workbench/seed-first-workspace';

beforeEach(() => {
	vi.clearAllMocks();
});

test('returns a failure when create-workspace IPC rejects', async () => {
	createWorkspace.mockRejectedValue(new Error('Create IPC unavailable.'));

	const result = await seedFirstWorkspace({
		navigate,
		persistSelection: vi.fn(),
		repositoryId: 'repository-1',
	});

	expect(result).toEqual({
		error: 'Create IPC unavailable.',
		status: 'failure',
	});
	expect(navigate).not.toHaveBeenCalled();
});

test('returns the created workspace id when post-create navigation rejects', async () => {
	createWorkspace.mockResolvedValue({
		diagnostics: [],
		filesToCopy: null,
		status: 'success',
		workspace: {
			archivedAt: null,
			baseBranch: 'main',
			branchName: 'new-workspace',
			createdAt: '2026-06-08T12:00:00.000Z',
			id: 'workspace-1',
			metadata: {},
			name: 'New Workspace',
			path: '/tmp/workspaces/demo/new-workspace',
			repositoryId: 'repository-1',
			slug: 'new-workspace',
			updatedAt: '2026-06-08T12:00:00.000Z',
		},
	});
	queryClient.invalidateQueries.mockResolvedValue(undefined);
	queryClient.fetchQuery.mockResolvedValue({
		generatedAt: '2026-06-08T12:00:00.000Z',
		repositories: [
			{
				createdAt: '2026-06-08T12:00:00.000Z',
				defaultBranch: 'main',
				id: 'repository-1',
				metadata: {},
				name: 'Demo',
				path: '/tmp/repos/demo',
				slug: 'demo',
				updatedAt: '2026-06-08T12:00:00.000Z',
				workspaces: [
					{
						archivedAt: null,
						baseBranch: 'main',
						branchName: 'new-workspace',
						createdAt: '2026-06-08T12:00:00.000Z',
						id: 'workspace-1',
						metadata: {},
						name: 'New Workspace',
						path: '/tmp/workspaces/demo/new-workspace',
						repositoryId: 'repository-1',
						slug: 'new-workspace',
						updatedAt: '2026-06-08T12:00:00.000Z',
					},
				],
			},
		],
	});
	navigate.mockRejectedValue(new Error('Route unavailable.'));

	const result = await seedFirstWorkspace({
		navigate,
		persistSelection: vi.fn(),
		repositoryId: 'repository-1',
	});

	expect(result).toEqual({
		error: 'Route unavailable.',
		status: 'failure',
		workspaceId: 'workspace-1',
	});
});
