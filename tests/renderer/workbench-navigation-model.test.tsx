import { expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { WorkbenchEmptyStateShell } from '../../src/renderer/components/workbench-empty-state';

function withQueryClient(node: ReactNode): ReactNode {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

import {
	getRenderableNavigationSnapshot,
	mapNavigationSnapshotToProjects,
	mapRepositoriesToProjects,
	resolveWorkspaceNavigationRenderState,
	resolveWorkspaceNavigationSelection,
	resolveWorkspaceRouteParams,
} from '../../src/renderer/lib/workbench';
import type { RepositoryWorkspaceNavigationSnapshot } from '../../src/shared/ipc';

const navigationSnapshot: RepositoryWorkspaceNavigationSnapshot = {
	generatedAt: '2026-06-06T00:00:00.000Z',
	repositories: [
		{
			createdAt: '2026-06-06T00:00:00.000Z',
			defaultBranch: 'master',
			id: 'repo-1',
			metadata: {
				avatarUrl: 'https://example.com/alice.png',
				owner: 'alice',
			},
			name: 'Ensemble',
			path: '/Users/alice/Ensemble/repos/ensemble',
			slug: 'ensemble',
			updatedAt: '2026-06-06T00:00:00.000Z',
			workspaces: [
				{
					archivedAt: null,
					baseBranch: 'master',
					branchName: 'philipp/the-120',
					createdAt: '2026-06-06T00:00:00.000Z',
					id: 'workspace-1',
					metadata: {
						linearIssue: 'THE-120',
					},
					name: 'THE-120 Sidebar nav',
					path: '/Users/alice/Ensemble/workspaces/ensemble/the-120',
					repositoryId: 'repo-1',
					slug: 'the-120',
					updatedAt: '2026-06-06T00:00:00.000Z',
				},
			],
		},
		{
			createdAt: '2026-06-06T00:00:00.000Z',
			defaultBranch: 'main',
			id: 'repo-2',
			metadata: {},
			name: 'Agent Lab',
			path: '/Users/alice/Ensemble/repos/agent-lab',
			slug: 'agent-lab',
			updatedAt: '2026-06-06T00:00:00.000Z',
			workspaces: [
				{
					archivedAt: null,
					baseBranch: null,
					branchName: null,
					createdAt: '2026-06-06T00:00:00.000Z',
					id: 'workspace-2',
					metadata: {},
					name: 'Draft workspace',
					path: '/Users/alice/Ensemble/workspaces/agent-lab/draft',
					repositoryId: 'repo-2',
					slug: 'draft',
					updatedAt: '2026-06-06T00:00:00.000Z',
				},
			],
		},
	],
};

test('maps SQLite navigation snapshot into workbench shell projects', () => {
	const projects = mapNavigationSnapshotToProjects(navigationSnapshot);

	expect(projects).toHaveLength(2);
	expect(projects[0]).toMatchObject({
		id: 'repo-1',
		name: 'Ensemble',
		owner: {
			avatarUrl: 'https://example.com/alice.png',
			name: 'alice',
		},
	});
	expect(projects[0]?.workspaces[0]).toMatchObject({
		branchName: 'philipp/the-120',
		id: 'workspace-1',
		name: 'THE-120 Sidebar nav',
		projectId: 'repo-1',
		sourceSummary: 'branched from master',
	});
	expect(projects[1]?.workspaces[0]).toMatchObject({
		branchName: 'main',
		sourceSummary: 'repository default branch main',
	});
	expect(JSON.stringify(projects)).not.toContain('Conductor shell rework');
});

test('maps repositories array identically to snapshot mapping', () => {
	expect(mapRepositoriesToProjects(navigationSnapshot.repositories)).toEqual(
		mapNavigationSnapshotToProjects(navigationSnapshot),
	);
	expect(mapRepositoriesToProjects(undefined)).toEqual([]);
	expect(mapRepositoriesToProjects(null)).toEqual([]);
});

test('resolves workspace route params for live targets and rejects missing ones', () => {
	const projects = mapNavigationSnapshotToProjects(navigationSnapshot);

	expect(
		resolveWorkspaceRouteParams(projects, 'repo-2', 'workspace-2'),
	).toEqual({
		chatId: 'workspace-2:overview',
		projectId: 'repo-2',
		workspaceId: 'workspace-2',
	});
	expect(resolveWorkspaceRouteParams(projects, 'repo-1', 'missing')).toBeNull();
	expect(
		resolveWorkspaceRouteParams(projects, 'missing', 'workspace-1'),
	).toBeNull();
});

test('keeps cached navigation snapshot renderable while live query is pending', () => {
	expect(
		getRenderableNavigationSnapshot({
			cachedSnapshot: navigationSnapshot,
			querySnapshot: undefined,
		}),
	).toBe(navigationSnapshot);
	expect(
		getRenderableNavigationSnapshot({
			cachedSnapshot: navigationSnapshot,
			querySnapshot: {
				generatedAt: '2026-06-06T00:00:01.000Z',
				repositories: [],
			},
		}),
	).toEqual({
		generatedAt: '2026-06-06T00:00:01.000Z',
		repositories: [],
	});
	expect(
		getRenderableNavigationSnapshot({
			cachedSnapshot: undefined,
			querySnapshot: undefined,
		}),
	).toBeNull();
});

test('resolves route, stored, and first workspace selections in order', () => {
	const projects = mapNavigationSnapshotToProjects(navigationSnapshot);

	expect(
		resolveWorkspaceNavigationSelection({
			projects,
			routeProjectId: 'repo-2',
			routeWorkspaceId: 'workspace-2',
			storedSelection: {
				projectId: 'repo-1',
				workspaceId: 'workspace-1',
			},
		}),
	).toMatchObject({
		source: 'route',
		workspace: {
			id: 'workspace-2',
		},
	});
	expect(
		resolveWorkspaceNavigationSelection({
			projects,
			routeProjectId: 'missing',
			routeWorkspaceId: 'missing',
			storedSelection: {
				projectId: 'repo-1',
				workspaceId: 'workspace-1',
			},
		}),
	).toBeNull();
	expect(
		resolveWorkspaceNavigationSelection({
			projects,
			storedSelection: {
				projectId: 'repo-1',
				workspaceId: 'workspace-1',
			},
		}),
	).toMatchObject({
		source: 'stored',
		workspace: {
			id: 'workspace-1',
		},
	});
	expect(
		resolveWorkspaceNavigationSelection({
			projects,
			storedSelection: {
				projectId: 'missing',
				workspaceId: 'missing',
			},
		}),
	).toMatchObject({
		source: 'first',
		workspace: {
			id: 'workspace-1',
		},
	});
});

test('keeps previous navigation render state during transient loading gaps', () => {
	const projects = mapNavigationSnapshotToProjects(navigationSnapshot);
	const selection = resolveWorkspaceNavigationSelection({
		projects,
		routeProjectId: 'repo-1',
		routeWorkspaceId: 'workspace-1',
	});

	expect(selection).toBeTruthy();

	const currentState = resolveWorkspaceNavigationRenderState({
		canUsePreviousState: false,
		previousState: null,
		projects,
		selection,
	});

	expect(currentState).toMatchObject({
		source: 'current',
		selection: {
			workspace: {
				id: 'workspace-1',
			},
		},
	});
	expect(
		resolveWorkspaceNavigationRenderState({
			canUsePreviousState: true,
			previousState: currentState,
			projects: [],
			selection: null,
		}),
	).toMatchObject({
		projects,
		source: 'previous',
		selection: {
			workspace: {
				id: 'workspace-1',
			},
		},
	});
	expect(
		resolveWorkspaceNavigationRenderState({
			canUsePreviousState: false,
			previousState: currentState,
			projects: [],
			selection: null,
		}),
	).toBeNull();
});

test('uses previous navigation projects for route changes during loading gaps', () => {
	const projects = mapNavigationSnapshotToProjects(navigationSnapshot);
	const selection = resolveWorkspaceNavigationSelection({
		projects,
		routeProjectId: 'repo-1',
		routeWorkspaceId: 'workspace-1',
	});
	const previousState = resolveWorkspaceNavigationRenderState({
		canUsePreviousState: false,
		previousState: null,
		projects,
		selection,
	});

	expect(previousState).toBeTruthy();
	expect(
		resolveWorkspaceNavigationRenderState({
			canUsePreviousState: true,
			previousState,
			projects: [],
			routeProjectId: 'repo-2',
			routeWorkspaceId: 'workspace-2',
			selection: null,
		}),
	).toMatchObject({
		source: 'previous',
		selection: {
			source: 'route',
			workspace: {
				id: 'workspace-2',
			},
		},
	});
	expect(
		resolveWorkspaceNavigationRenderState({
			canUsePreviousState: true,
			previousState,
			projects: [],
			routeProjectId: 'repo-2',
			routeWorkspaceId: 'missing',
			selection: null,
		}),
	).toBeNull();
});

test('renders live navigation records and true empty repository state', () => {
	const projects = mapNavigationSnapshotToProjects(navigationSnapshot);
	const populatedMarkup = renderToStaticMarkup(
		withQueryClient(
			<WorkbenchEmptyStateShell
				activeView='dashboard'
				emptyState={{
					detail: 'Previewing live navigation rows.',
					title: 'No active workspace',
				}}
				health={{
					detail: 'SQLite navigation fixture',
					label: 'IPC online',
					state: 'online',
				}}
				onStaticNavigationSelect={() => undefined}
				onWorkspaceSelect={() => undefined}
				projects={projects}
			/>,
		),
	);
	const emptyMarkup = renderToStaticMarkup(
		withQueryClient(
			<WorkbenchEmptyStateShell
				activeView='dashboard'
				emptyState={{
					detail:
						'Open or create a repository to populate the workspace navigation.',
					title: 'No repositories yet',
				}}
				health={{
					detail: 'SQLite navigation fixture',
					label: 'IPC online',
					state: 'online',
				}}
				onStaticNavigationSelect={() => undefined}
				onWorkspaceSelect={() => undefined}
				projects={[]}
			/>,
		),
	);

	expect(populatedMarkup).toContain('THE-120 Sidebar nav');
	expect(populatedMarkup).toContain('Draft workspace');
	expect(populatedMarkup).toContain('2 repos');
	expect(populatedMarkup).toContain('2 workspaces');
	expect(populatedMarkup).not.toContain('Conductor shell rework');
	expect(emptyMarkup).toContain('No repositories yet');
	expect(emptyMarkup).toContain('Dashboard');
	expect(emptyMarkup).toContain('Help');
	expect(emptyMarkup).toContain('Repositories');
	expect(emptyMarkup).toContain('0 repos');
	expect(emptyMarkup).toContain('0 workspaces');
});
