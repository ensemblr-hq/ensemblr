import { QueryClient } from '@tanstack/react-query';
import { expect, test } from 'vitest';

import { forgetWorkspaceInListViews } from '@/renderer/api/ensemblr/forget-workspace-in-list-views';
import { ensemblrQueryKeys } from '@/renderer/api/ensemblr/query-keys';
import type {
	RepositoryWorkspaceNavigationRepository,
	RepositoryWorkspaceNavigationSnapshot,
} from '@/shared/ipc/contracts/repository-navigation';

/** Builds a navigation workspace row with only the fields these tests read. */
function workspace(
	id: string,
): RepositoryWorkspaceNavigationRepository['workspaces'][number] {
	return {
		archivedAt: null,
		baseBranch: 'master',
		branchName: `branch-${id}`,
		createdAt: '2026-08-19T00:00:00.000Z',
		id,
		metadata: {},
		name: id,
		path: `/workspaces/${id}`,
		repositoryId: 'repo-1',
		slug: id,
		updatedAt: '2026-08-19T00:00:00.000Z',
	};
}

/** Builds a one-repository navigation snapshot holding the given workspace ids. */
function snapshot(
	workspaceIds: string[],
): RepositoryWorkspaceNavigationSnapshot {
	return {
		generatedAt: '2026-08-19T00:00:00.000Z',
		repositories: [
			{
				createdAt: '2026-08-19T00:00:00.000Z',
				defaultBranch: 'master',
				id: 'repo-1',
				metadata: {},
				name: 'repo-1',
				path: '/repos/repo-1',
				slug: 'repo-1',
				updatedAt: '2026-08-19T00:00:00.000Z',
				workspaces: workspaceIds.map(workspace),
			},
		],
	};
}

/** A query client seeded with the given navigation snapshot. */
function clientWith(data: RepositoryWorkspaceNavigationSnapshot): QueryClient {
	const queryClient = new QueryClient();
	queryClient.setQueryData(
		ensemblrQueryKeys.repositoryWorkspaceNavigation(),
		data,
	);
	return queryClient;
}

const navigationKey = ensemblrQueryKeys.repositoryWorkspaceNavigation();

test('drops the workspace from the cached navigation snapshot', () => {
	const queryClient = clientWith(snapshot(['keep-me', 'drop-me']));

	forgetWorkspaceInListViews(queryClient, 'drop-me');

	const next =
		queryClient.getQueryData<RepositoryWorkspaceNavigationSnapshot>(
			navigationKey,
		);
	expect(next?.repositories[0]?.workspaces.map((entry) => entry.id)).toEqual([
		'keep-me',
	]);
});

test('leaves the snapshot untouched by reference when it never held the workspace', () => {
	const seeded = snapshot(['keep-me']);
	const queryClient = clientWith(seeded);

	forgetWorkspaceInListViews(queryClient, 'never-here');

	expect(queryClient.getQueryData(navigationKey)).toBe(seeded);
});

test('does not mutate the snapshot it replaces', () => {
	const seeded = snapshot(['keep-me', 'drop-me']);
	const queryClient = clientWith(seeded);

	forgetWorkspaceInListViews(queryClient, 'drop-me');

	expect(seeded.repositories[0]?.workspaces).toHaveLength(2);
});

test('is a no-op when the navigation query has no data yet', () => {
	const queryClient = new QueryClient();

	forgetWorkspaceInListViews(queryClient, 'drop-me');

	expect(queryClient.getQueryData(navigationKey)).toBeUndefined();
});
