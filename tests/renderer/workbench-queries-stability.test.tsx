// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useWorkbenchQueries } from '@/renderer/hooks/workbench-shell/route-layout/use-workbench-queries';
import type { WorkbenchShellData } from '@/renderer/types/workbench';
import type {
	RepositoryWorkspaceNavigationSnapshot,
	RepositoryWorkspaceNavigationWorkspace,
} from '@/shared/ipc/contracts/repository-navigation';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from './support/dom';

const NOW = '2026-08-16T00:00:00.000Z';

/** Builds one navigation workspace row with a resolvable branch scope. */
function workspaceRow(id: string): RepositoryWorkspaceNavigationWorkspace {
	return {
		archivedAt: null,
		baseBranch: 'master',
		branchName: `feature/${id}`,
		createdAt: NOW,
		id,
		metadata: {},
		name: id,
		path: `/tmp/${id}`,
		repositoryId: 'repo-1',
		slug: id,
		updatedAt: NOW,
	};
}

/** Builds a navigation snapshot carrying the given workspace ids. */
function snapshot(
	workspaceIds: string[],
): RepositoryWorkspaceNavigationSnapshot {
	return {
		generatedAt: NOW,
		repositories: [
			{
				createdAt: NOW,
				defaultBranch: 'master',
				id: 'repo-1',
				metadata: {},
				name: 'repo-1',
				path: '/tmp/repo-1',
				slug: 'repo-1',
				updatedAt: NOW,
				workspaces: workspaceIds.map(workspaceRow),
			},
		],
	};
}

/** Loader data with no pre-seeded navigation snapshot. */
function loaderData(): WorkbenchShellData {
	return { navigationSnapshot: null } as unknown as WorkbenchShellData;
}

describe('useWorkbenchQueries projects identity', () => {
	afterEach(() => {
		clearEnsemblrApi();
	});

	// `useWorkspaceSelectionPersistence` writes an atom behind a
	// `renderState.projects === projects` reference guard, so any render that
	// hands back a fresh `projects` array closes a render -> atom -> render cycle
	// and live-locks the shell. Pinning identity here keeps that guard sound.
	it('returns the same projects reference across re-renders', async () => {
		// A non-zero summary is the load-bearing part: navigation rows always map to
		// a zeroed changeSummary, so a differing git status makes
		// applyWorkspaceChangeSummaries build a fresh array on every call it runs.
		installEnsemblrApi({
			getWorkspaceGitStatus: () =>
				Promise.resolve({
					files: [],
					summary: { additions: 5, deletions: 2, files: 1 },
				}),
			health: () => Promise.resolve({ status: 'ok' }),
			repositoryWorkspaceNavigation: () =>
				Promise.resolve(snapshot(['ws-a', 'ws-b'])),
			setupDiagnostics: () => Promise.resolve({ checks: [], status: 'ok' }),
		});
		const client = createTestQueryClient();

		const { rerender, result } = renderHook(
			() => useWorkbenchQueries({ loaderData: loaderData() }),
			{
				wrapper: ({ children }) => (
					<QueryClientProvider client={client}>{children}</QueryClientProvider>
				),
			},
		);

		await waitFor(() => {
			expect(
				result.current.projects[0]?.workspaces[0]?.changeSummary.additions,
			).toBe(5);
		});

		const first = result.current.projects;
		rerender();
		const second = result.current.projects;
		rerender();
		const third = result.current.projects;

		expect(second).toBe(first);
		expect(third).toBe(first);
	});
});
