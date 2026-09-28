// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, test } from 'vitest';

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr/query-keys';
import { useWorkspaceSidebarRow } from '../../src/renderer/hooks/workbench-shell/navigation-sidebar/use-workspace-sidebar-row';
import {
	applyWorkspaceChangeSummaries,
	mapNavigationSnapshotToProjects,
} from '../../src/renderer/lib/workbench';
import type { WorkspaceShellModel } from '../../src/renderer/types/workbench';
import type { GetPullRequestSnapshotResult } from '../../src/shared/ipc/contracts/github';
import type { GetWorkspaceGitStatusResult } from '../../src/shared/ipc/contracts/workspace-git';
import { createTestQueryClient } from './support/dom';

const WORKSPACE_ID = 'workspace-1';
const WORKSPACE_CWD = '/repo/feature';
const SYNCED_AT = '2026-07-15T09:00:00.000Z';

/**
 * A navigation row for a workspace whose pushed pull request GitHub reports as
 * ready to merge, with the overview poll's reading folded in when given one —
 * the same path the workbench's project list takes.
 */
function readyWorkspace(uncommittedFiles?: number): WorkspaceShellModel {
	const projects = mapNavigationSnapshotToProjects({
		generatedAt: SYNCED_AT,
		repositories: [
			{
				createdAt: SYNCED_AT,
				defaultBranch: 'main',
				id: 'repo-1',
				metadata: {},
				name: 'repo',
				path: '/repo',
				slug: 'repo',
				updatedAt: SYNCED_AT,
				workspaces: [
					{
						archivedAt: null,
						baseBranch: 'main',
						branchName: 'feature',
						createdAt: SYNCED_AT,
						id: WORKSPACE_ID,
						metadata: {},
						name: 'Feature',
						path: WORKSPACE_CWD,
						pullRequest: {
							branchSync: {
								ahead: 0,
								behind: 0,
								branchName: 'feature',
								hasUpstream: true,
							},
							number: 7,
							status: 'ready',
							syncedAt: SYNCED_AT,
						},
						repositoryId: 'repo-1',
						slug: 'feature',
						updatedAt: SYNCED_AT,
					},
				],
			},
		],
	});
	const [project] =
		uncommittedFiles === undefined
			? projects
			: applyWorkspaceChangeSummaries(projects, [
					{
						changeSummary: { additions: 12, deletions: 3, files: 4 },
						uncommittedFiles,
						workspaceId: WORKSPACE_ID,
					},
				]);
	const workspace = project?.workspaces[0];
	if (!workspace) {
		throw new Error('fixture workspace missing');
	}
	return workspace;
}

/** The live snapshot an active row leaves behind: ready, and fully pushed. */
const READY_SNAPSHOT: GetPullRequestSnapshotResult = {
	fromCache: true,
	snapshot: {
		branchSync: {
			ahead: 0,
			behind: 0,
			branchName: 'feature',
			hasUpstream: true,
		},
		pullRequest: {
			additions: 1,
			baseRefName: 'main',
			body: 'A described pull request.',
			checks: [{ bucket: 'passing', id: 'check-1', name: 'build' }],
			comments: [],
			deletions: 0,
			deployments: [],
			headRefName: 'feature',
			headRefOid: 'abc123',
			isDraft: false,
			mergeable: 'mergeable',
			mergeStateStatus: 'CLEAN',
			number: 7,
			reviewDecision: 'APPROVED',
			state: 'open',
			title: 'PR #7',
			updatedAt: SYNCED_AT,
			url: 'https://example.test/pr/7',
		},
		syncedAt: SYNCED_AT,
	},
};

/** Renders the row hook against a query cache seeded with the given reads. */
function renderRow(options: {
	isActive: boolean;
	seedSnapshot?: boolean;
	workingTree?: GetWorkspaceGitStatusResult;
	workspace: WorkspaceShellModel;
}) {
	const client = createTestQueryClient();
	if (options.seedSnapshot) {
		client.setQueryData(
			ensemblrQueryKeys.pullRequestSnapshot(WORKSPACE_ID),
			READY_SNAPSHOT,
		);
	}
	client.setQueryData(ensemblrQueryKeys.reviewComments(WORKSPACE_ID), {
		comments: [],
	});
	client.setQueryData(ensemblrQueryKeys.reviewTodos(WORKSPACE_ID), {
		todos: [],
	});
	if (options.workingTree) {
		client.setQueryData(
			ensemblrQueryKeys.workspaceGitStatus(WORKSPACE_CWD),
			options.workingTree,
		);
	}
	const wrapper = ({ children }: PropsWithChildren) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	return renderHook(
		() =>
			useWorkspaceSidebarRow({
				isActive: options.isActive,
				workspace: options.workspace,
			}),
		{ wrapper },
	);
}

describe('useWorkspaceSidebarRow', () => {
	test('an unfocused row with uncommitted work stays on commit and push', () => {
		const { result } = renderRow({
			isActive: false,
			seedSnapshot: true,
			workspace: readyWorkspace(2),
		});
		expect(result.current.sidebarState.kind).toBe('pr-unpushed');
	});

	test('an unfocused row never opened this session reads the overview count too', () => {
		const { result } = renderRow({
			isActive: false,
			workspace: readyWorkspace(2),
		});
		expect(result.current.sidebarState.kind).toBe('pr-unpushed');
	});

	test('before the overview poll answers an unfocused row keeps the sync-state verdict', () => {
		const { result } = renderRow({
			isActive: false,
			seedSnapshot: true,
			workspace: readyWorkspace(),
		});
		expect(result.current.sidebarState.kind).toBe('pr-ready');
	});

	test('an unfocused row with nothing uncommitted is ready to merge', () => {
		const { result } = renderRow({
			isActive: false,
			seedSnapshot: true,
			workspace: readyWorkspace(0),
		});
		expect(result.current.sidebarState.kind).toBe('pr-ready');
	});

	test('the focused row trusts its live working-tree read over the overview count', () => {
		const { result } = renderRow({
			isActive: true,
			seedSnapshot: true,
			workingTree: {
				files: [],
				summary: { additions: 0, deletions: 0, files: 0 },
			},
			workspace: readyWorkspace(2),
		});
		expect(result.current.sidebarState.kind).toBe('pr-ready');
	});
});
