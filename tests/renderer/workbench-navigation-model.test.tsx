import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { WorkbenchEmptyStateShell } from '../../src/renderer/components/workbench-empty-state';
import {
	mapNavigationSnapshotToProjects,
	resolveWorkspaceNavigationSelection,
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

test('renders live navigation records and true empty repository state', () => {
	const projects = mapNavigationSnapshotToProjects(navigationSnapshot);
	const populatedMarkup = renderToStaticMarkup(
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
			onDashboardSelect={() => undefined}
			onHelpSelect={() => undefined}
			onHistorySelect={() => undefined}
			onSettingsSelect={() => undefined}
			onWorkspaceSelect={() => undefined}
			projects={projects}
		/>,
	);
	const emptyMarkup = renderToStaticMarkup(
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
			onDashboardSelect={() => undefined}
			onHelpSelect={() => undefined}
			onHistorySelect={() => undefined}
			onSettingsSelect={() => undefined}
			onWorkspaceSelect={() => undefined}
			projects={[]}
		/>,
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
