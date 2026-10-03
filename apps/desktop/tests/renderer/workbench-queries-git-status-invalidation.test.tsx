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
import type { WorkspaceFilesChangedBroadcast } from '@/shared/ipc/contracts/workspace-files';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from './support/dom';

const NOW = '2026-09-12T00:00:00.000Z';

/** One navigation workspace row with a resolvable branch scope, at `/tmp/<id>`. */
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

/** A navigation snapshot carrying one workspace. */
function snapshot(): RepositoryWorkspaceNavigationSnapshot {
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
				workspaces: [workspaceRow('ws-a')],
			},
		],
	};
}

/** Loader data with no pre-seeded navigation snapshot. */
function loaderData(): WorkbenchShellData {
	return { navigationSnapshot: null } as unknown as WorkbenchShellData;
}

describe('useWorkbenchQueries git-status invalidation', () => {
	afterEach(() => {
		clearEnsemblrApi();
	});

	// A write to an existing file moves the diff stats and nothing in the listed
	// tree, so the broadcast that carries neither flag is exactly the one the
	// sidebar's git status still has to answer.
	it('refetches a workspace git status for a change that touched no entry and no settings input', async () => {
		let callCount = 0;
		let broadcast:
			| ((event: WorkspaceFilesChangedBroadcast) => void)
			| undefined;

		installEnsemblrApi({
			getWorkspaceGitStatus: () => {
				callCount += 1;
				return Promise.resolve({
					files: [],
					summary: {
						additions: callCount === 1 ? 1 : 7,
						deletions: 0,
						files: 1,
					},
				});
			},
			health: () => Promise.resolve({ status: 'ok' }),
			onWorkspaceFilesChanged: (
				listener: (event: WorkspaceFilesChangedBroadcast) => void,
			) => {
				broadcast = listener;
				return () => {
					broadcast = undefined;
				};
			},
			repositoryWorkspaceNavigation: () => Promise.resolve(snapshot()),
			setupDiagnostics: () => Promise.resolve({ checks: [], status: 'ok' }),
		});
		const client = createTestQueryClient();

		const { result } = renderHook(
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
			).toBe(1);
		});

		broadcast?.({
			membershipChanged: false,
			settingsChanged: false,
			workspaceCwd: '/tmp/ws-a',
		});

		await waitFor(() => {
			expect(
				result.current.projects[0]?.workspaces[0]?.changeSummary.additions,
			).toBe(7);
		});
	});

	it('refetches a workspace git status when its file watcher broadcasts a change', async () => {
		let callCount = 0;
		let broadcast:
			| ((event: WorkspaceFilesChangedBroadcast) => void)
			| undefined;

		installEnsemblrApi({
			getWorkspaceGitStatus: () => {
				callCount += 1;
				return Promise.resolve({
					files: [],
					summary: {
						additions: callCount === 1 ? 1 : 7,
						deletions: 0,
						files: 1,
					},
				});
			},
			health: () => Promise.resolve({ status: 'ok' }),
			onWorkspaceFilesChanged: (
				listener: (event: { workspaceCwd: string }) => void,
			) => {
				broadcast = listener;
				return () => {
					broadcast = undefined;
				};
			},
			repositoryWorkspaceNavigation: () => Promise.resolve(snapshot()),
			setupDiagnostics: () => Promise.resolve({ checks: [], status: 'ok' }),
		});
		const client = createTestQueryClient();

		const { result } = renderHook(
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
			).toBe(1);
		});
		expect(broadcast).toBeDefined();

		broadcast?.({
			membershipChanged: true,
			settingsChanged: false,
			workspaceCwd: '/tmp/ws-a',
		});

		await waitFor(() => {
			expect(
				result.current.projects[0]?.workspaces[0]?.changeSummary.additions,
			).toBe(7);
		});
		expect(callCount).toBeGreaterThanOrEqual(2);
	});

	it('leaves other workspaces alone when a different workspace broadcasts a change', async () => {
		let callCount = 0;

		installEnsemblrApi({
			getWorkspaceGitStatus: () => {
				callCount += 1;
				return Promise.resolve({
					files: [],
					summary: { additions: 1, deletions: 0, files: 1 },
				});
			},
			health: () => Promise.resolve({ status: 'ok' }),
			onWorkspaceFilesChanged: (
				listener: (event: WorkspaceFilesChangedBroadcast) => void,
			) => {
				listener({
					membershipChanged: true,
					settingsChanged: true,
					workspaceCwd: '/tmp/some-other-workspace',
				});
				return () => {};
			},
			repositoryWorkspaceNavigation: () => Promise.resolve(snapshot()),
			setupDiagnostics: () => Promise.resolve({ checks: [], status: 'ok' }),
		});
		const client = createTestQueryClient();

		const { result } = renderHook(
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
			).toBe(1);
		});

		const callCountAfterSettling = callCount;
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(callCount).toBe(callCountAfterSettling);
	});
});
