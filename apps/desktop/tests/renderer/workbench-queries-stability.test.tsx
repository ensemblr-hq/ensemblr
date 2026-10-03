// @vitest-environment happy-dom

import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { Profiler } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensemblrQueryKeys } from '@/renderer/api/ensemblr/query-keys';
import { WorkbenchFrame } from '@/renderer/components/workbench-shell/frame';
import { NavigationProvider } from '@/renderer/components/workbench-shell/shell-contexts';
import { useWorkbenchLayoutModel } from '@/renderer/hooks/workbench-shell/route-layout/use-workbench-layout-model';
import { useWorkbenchQueries } from '@/renderer/hooks/workbench-shell/route-layout/use-workbench-queries';
import { pinnedWorkspaceIdsAtom } from '@/renderer/state/workspace';
import type { WorkbenchShellRouteState } from '@/renderer/types/components';
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
	renderWithProviders,
} from './support/dom';

const { rowRenders, stubRouter } = vi.hoisted(() => ({
	rowRenders: [] as string[],
	stubRouter: { navigate: () => Promise.resolve() },
}));

vi.mock('@tanstack/react-router', async () => {
	const actual = await vi.importActual<typeof import('@tanstack/react-router')>(
		'@tanstack/react-router',
	);
	return {
		...actual,
		useNavigate: () => stubRouter.navigate,
		useRouter: () => stubRouter,
	};
});

vi.mock(
	'@/renderer/hooks/workbench-shell/navigation-sidebar/use-workspace-sidebar-row',
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import('@/renderer/hooks/workbench-shell/navigation-sidebar/use-workspace-sidebar-row')
			>();
		return {
			...actual,
			useWorkspaceSidebarRow: (
				input: Parameters<typeof actual.useWorkspaceSidebarRow>[0],
			) => {
				rowRenders.push(input.workspace.id);
				return actual.useWorkspaceSidebarRow(input);
			},
		};
	},
);

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
 * A snapshot whose workspaces each have a pull request in the given status,
 * observed at the given instant — what the navigation poll reads back after
 * each sweeper write.
 * @param status - Compact status the sweeper observed for every pull request.
 * @param syncedAt - When the sweeper observed it; also the snapshot's `generatedAt`.
 * @param workspaceIds - The workspaces the repository carries.
 * @returns The navigation snapshot the poll would answer with.
 */
function sweptSnapshot(
	status: WorkspacePrPresentationStatus,
	syncedAt: string,
	workspaceIds: string[] = ['ws-a'],
): RepositoryWorkspaceNavigationSnapshot {
	const base = snapshot(workspaceIds);
	return {
		generatedAt: syncedAt,
		pullRequestSyncedAt: Object.fromEntries(
			workspaceIds.map((workspaceId) => [workspaceId, syncedAt]),
		),
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
 * A bridge whose navigation poll answers with each of the given snapshots in
 * turn, holding on the last one.
 * @param polls - What successive navigation reads return.
 * @returns The bridge methods the workbench queries read.
 */
function pollingApi(
	polls: RepositoryWorkspaceNavigationSnapshot[],
): Record<string, unknown> {
	let calls = 0;
	return {
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
	};
}

/**
 * Renders the workbench queries against a navigation poll that answers with
 * each of the given snapshots in turn, holding on the last one.
 * @param polls - What successive navigation reads return.
 * @returns The rendered hook and the client whose cache it reads.
 */
function renderAgainstPolls(polls: RepositoryWorkspaceNavigationSnapshot[]) {
	installEnsemblrApi(pollingApi(polls));
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

const SIDEBAR_WORKSPACE_IDS = ['ws-a', 'ws-b', 'ws-c'];
const PINNED_WORKSPACE_ID = 'ws-c';
const SWEPT_AT = '2026-08-16T00:02:00.000Z';
const SIDEBAR_LOADER_DATA = loaderData();
const SIDEBAR_ROUTE_STATE: WorkbenchShellRouteState = {
	routeProjectId: 'repo-1',
	routeWorkspaceId: 'ws-a',
	view: 'workspace',
};
const NO_LINK_RENDERERS = {
	renderStaticLink: undefined,
	renderWorkspaceLink: undefined,
};

/**
 * Lets the whole shell mount against a bridge that only stubs what the test
 * cares about: an unstubbed subscription hands back an unsubscribe, and any
 * other unstubbed call rejects, which a query settles into its error state.
 * @param api - The methods the test does stub.
 * @returns A bridge answering for every method the shell reaches for.
 */
function withInertFallbacks(
	api: Record<string, unknown>,
): Record<string, unknown> {
	return new Proxy(api, {
		get: (target, property) => {
			if (typeof property !== 'string' || property in target) {
				return Reflect.get(target, property);
			}
			return property.startsWith('on')
				? () => () => {}
				: () => Promise.reject(new Error(`${property} is not stubbed`));
		},
	});
}

/**
 * The shell layout's own wiring, minus the router: the layout model built from
 * the live queries feeds the frame exactly as `WorkbenchShellLayout` feeds it,
 * so every callback a row receives is the production one.
 */
function SidebarShell() {
	const { model } = useWorkbenchLayoutModel({
		loaderData: SIDEBAR_LOADER_DATA,
		routeState: SIDEBAR_ROUTE_STATE,
	});

	return (
		<NavigationProvider value={NO_LINK_RENDERERS}>
			<WorkbenchFrame
				activeProject={model.activeProject}
				activeView={SIDEBAR_ROUTE_STATE.view}
				activeWorkspace={model.activeWorkspace}
				addProjectMenu={model.addProjectMenu}
				health={model.health}
				onAddProject={model.onAddProject}
				onStaticNavigationSelect={model.navigateToStaticRoute}
				onWorkspaceSelect={model.navigateToWorkspace}
				projects={model.displayProjects}
				resolveWorkspaceRouteSearch={model.resolveWorkspaceRouteSearch}
			>
				<div />
			</WorkbenchFrame>
		</NavigationProvider>
	);
}

/**
 * Mounts the shell against the given polls, pins one workspace so both row call
 * sites render, and waits until nothing is in flight.
 * @param polls - What successive navigation reads return.
 * @returns The client to poll through, and a reader for how often the shell has committed.
 */
async function renderSidebarShell(
	polls: RepositoryWorkspaceNavigationSnapshot[],
): Promise<{ client: QueryClient; shellCommits: () => number }> {
	installEnsemblrApi(
		withInertFallbacks({
			...pollingApi(polls),
			health: () =>
				Promise.resolve({
					appName: 'Ensemblr',
					config: { blocksReadiness: false, diagnostics: [] },
					database: { status: 'ok' },
					status: 'ok',
				}),
			listTerminalSessions: () => Promise.resolve({ sessions: [] }),
		}),
	);
	let commits = 0;
	const { client } = renderWithProviders(
		<Profiler
			id='sidebar-shell'
			onRender={() => {
				commits += 1;
			}}
		>
			<SidebarShell />
		</Profiler>,
	);
	await screen.findByRole('button', { name: 'Open workspace ws-a' });
	act(() => {
		getDefaultStore().set(pinnedWorkspaceIdsAtom, [PINNED_WORKSPACE_ID]);
	});
	await screen.findByText('Pinned');
	await waitFor(() => {
		expect(client.isFetching()).toBe(0);
	});
	return { client, shellCommits: () => commits };
}

describe('workspace sidebar rows across a navigation poll', () => {
	afterEach(() => {
		getDefaultStore().set(pinnedWorkspaceIdsAtom, []);
		rowRenders.length = 0;
		clearEnsemblrApi();
	});

	// THE-219: the shell re-renders on every poll even when it brought nothing
	// new, and a sweep moves every pull request's stamp. Neither may reach a row:
	// the row is the memo boundary, so everything handed across it has to
	// survive the shell's render, and the stamp has to stay out of its hooks.
	it('re-renders no row when the poll only re-stamps', async () => {
		const { client, shellCommits } = await renderSidebarShell([
			sweptSnapshot('checking', NOW, SIDEBAR_WORKSPACE_IDS),
			sweptSnapshot('checking', SWEPT_AT, SIDEBAR_WORKSPACE_IDS),
		]);
		const commitsBefore = shellCommits();
		rowRenders.length = 0;

		await pollNavigation(client, SWEPT_AT);
		await waitFor(() => {
			expect(client.isFetching()).toBe(0);
		});

		expect(shellCommits()).toBeGreaterThan(commitsBefore);
		expect(rowRenders).toEqual([]);
	});

	it('still re-renders a row whose workspace the poll changed', async () => {
		const { client } = await renderSidebarShell([
			sweptSnapshot('checking', NOW, SIDEBAR_WORKSPACE_IDS),
			sweptSnapshot('ready', SWEPT_AT, SIDEBAR_WORKSPACE_IDS),
		]);
		rowRenders.length = 0;

		await pollNavigation(client, SWEPT_AT);

		await waitFor(() => {
			expect(rowRenders).toEqual(
				expect.arrayContaining(['ws-b', PINNED_WORKSPACE_ID]),
			);
		});
	});
});
