// @vitest-environment happy-dom

import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ensemblrQueryKeys } from '@/renderer/api/ensemblr/query-keys';
import { useWorkbenchQueries } from '@/renderer/hooks/workbench-shell/route-layout/use-workbench-queries';
import type { WorkbenchShellData } from '@/renderer/types/workbench';
import type {
	RepositoryWorkspaceNavigationSnapshot,
	RepositoryWorkspaceNavigationWorkspace,
	WorkspacePrPresentationStatus,
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
		pullRequestSyncedAt: {},
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

/**
 * A snapshot whose one workspace has a pull request in the given status,
 * observed at the given instant — what the navigation poll reads back after
 * each sweeper write.
 * @param status - Compact status the sweeper observed for the pull request.
 * @param syncedAt - When the sweeper observed it; also the snapshot's `generatedAt`.
 * @returns The navigation snapshot the poll would answer with.
 */
function sweptSnapshot(
	status: WorkspacePrPresentationStatus,
	syncedAt: string,
): RepositoryWorkspaceNavigationSnapshot {
	const base = snapshot(['ws-a']);
	return {
		generatedAt: syncedAt,
		pullRequestSyncedAt: { 'ws-a': syncedAt },
		repositories: base.repositories.map((repository) => ({
			...repository,
			workspaces: repository.workspaces.map((workspace) => ({
				...workspace,
				pullRequest: { branchSync: null, number: 7, status },
			})),
		})),
	};
}

/** Loader data with no pre-seeded navigation snapshot. */
function loaderData(): WorkbenchShellData {
	return { navigationSnapshot: null } as unknown as WorkbenchShellData;
}

/**
 * Renders the workbench queries against a navigation poll that answers with
 * each of the given snapshots in turn, holding on the last one.
 * @param polls - What successive navigation reads return.
 * @returns The rendered hook and the client whose cache it reads.
 */
function renderAgainstPolls(polls: RepositoryWorkspaceNavigationSnapshot[]) {
	let calls = 0;
	installEnsemblrApi({
		getWorkspaceGitStatus: () =>
			Promise.resolve({
				files: [],
				summary: { additions: 0, deletions: 0, files: 0 },
			}),
		health: () => Promise.resolve({ status: 'ok' }),
		onWorkspaceFilesChanged: () => () => {},
		repositoryWorkspaceNavigation: () => {
			const poll = polls[Math.min(calls, polls.length - 1)];
			calls += 1;
			return Promise.resolve(poll);
		},
		setupDiagnostics: () => Promise.resolve({ checks: [], status: 'ok' }),
	});
	const client = createTestQueryClient();
	const rendered = renderHook(
		() => useWorkbenchQueries({ loaderData: loaderData() }),
		{
			wrapper: ({ children }) => (
				<QueryClientProvider client={client}>{children}</QueryClientProvider>
			),
		},
	);
	return { ...rendered, client };
}

/**
 * Runs the next navigation poll and waits for its snapshot to land.
 * @param client - The client whose navigation query to refetch.
 * @param generatedAt - The `generatedAt` the next poll answers with.
 */
async function pollNavigation(
	client: QueryClient,
	generatedAt: string,
): Promise<void> {
	await act(() =>
		client.refetchQueries({
			queryKey: ensemblrQueryKeys.repositoryWorkspaceNavigation(),
		}),
	);
	await waitFor(() => {
		expect(
			client.getQueryData<RepositoryWorkspaceNavigationSnapshot>(
				ensemblrQueryKeys.repositoryWorkspaceNavigation(),
			)?.generatedAt,
		).toBe(generatedAt);
	});
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
			onWorkspaceFilesChanged: () => () => {},
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

	// THE-210: the sweeper re-stamps every pull request it observes, changed or
	// not. A poll that brings only a newer stamp must leave the tree — and every
	// row model mapped from it — exactly as it was.
	it('keeps the projects and their workspaces across a poll that only re-stamps', async () => {
		const { client, result } = renderAgainstPolls([
			sweptSnapshot('checking', '2026-08-16T00:00:00.000Z'),
			sweptSnapshot('checking', '2026-08-16T00:02:00.000Z'),
		]);
		await waitFor(() => {
			expect(
				result.current.projects[0]?.workspaces[0]?.pullRequest.status,
			).toBe('checking');
		});
		const projects = result.current.projects;
		const workspace = projects[0]?.workspaces[0];

		await pollNavigation(client, '2026-08-16T00:02:00.000Z');

		expect(result.current.projects).toBe(projects);
		expect(result.current.projects[0]?.workspaces[0]).toBe(workspace);
	});

	it('still rebuilds the projects when a poll brings a new status', async () => {
		const { client, result } = renderAgainstPolls([
			sweptSnapshot('checking', '2026-08-16T00:00:00.000Z'),
			sweptSnapshot('ready', '2026-08-16T00:02:00.000Z'),
		]);
		await waitFor(() => {
			expect(
				result.current.projects[0]?.workspaces[0]?.pullRequest.status,
			).toBe('checking');
		});
		const projects = result.current.projects;

		await pollNavigation(client, '2026-08-16T00:02:00.000Z');

		expect(result.current.projects).not.toBe(projects);
		expect(result.current.projects[0]?.workspaces[0]?.pullRequest.status).toBe(
			'ready-to-merge',
		);
	});
});
