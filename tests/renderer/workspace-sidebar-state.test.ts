import { GitBranchIcon, GitMergeIcon } from 'lucide-react';
import { describe, expect, test } from 'vitest';

import { mapNavigationSnapshotToProjects } from '../../src/renderer/lib/workbench';
import { getWorkspaceSidebarState } from '../../src/renderer/lib/workbench/workspace-sidebar-state';
import type { WorkspaceShellModel } from '../../src/renderer/types/workbench';
import type {
	RepositoryWorkspaceNavigationSnapshot,
	WorkspacePrPresentation,
} from '../../src/shared/ipc/contracts/repository-navigation';

function workspaceModelWith(
	pullRequest: WorkspacePrPresentation | null,
): WorkspaceShellModel {
	const snapshot: RepositoryWorkspaceNavigationSnapshot = {
		generatedAt: '2026-07-15T00:00:00.000Z',
		repositories: [
			{
				createdAt: '2026-07-15T00:00:00.000Z',
				defaultBranch: 'main',
				id: 'repo-1',
				metadata: {},
				name: 'Repo',
				path: '/repo',
				slug: 'repo',
				updatedAt: '2026-07-15T00:00:00.000Z',
				workspaces: [
					{
						archivedAt: null,
						baseBranch: 'main',
						branchName: 'feature',
						createdAt: '2026-07-15T00:00:00.000Z',
						id: 'workspace-1',
						metadata: {},
						name: 'Feature',
						path: '/repo/feature',
						pullRequest,
						repositoryId: 'repo-1',
						slug: 'feature',
						updatedAt: '2026-07-15T00:00:00.000Z',
					},
				],
			},
		],
	};
	const model = mapNavigationSnapshotToProjects(snapshot)[0]?.workspaces[0];
	if (!model) {
		throw new Error('expected a mapped workspace model');
	}
	return model;
}

describe('getWorkspaceSidebarState (sidebar rows)', () => {
	test('a merged PR row shows the merge icon', () => {
		const state = getWorkspaceSidebarState(
			workspaceModelWith({ number: 7, status: 'merged' }),
		);
		expect(state.kind).toBe('pr-merged');
		expect(state.icon).toBe(GitMergeIcon);
		expect(state.className).toContain('status-merged');
	});

	test('checks-failed / running / ready / open map to their PR kinds', () => {
		expect(
			getWorkspaceSidebarState(
				workspaceModelWith({ number: 7, status: 'blocked' }),
			).kind,
		).toBe('pr-blocked');
		expect(
			getWorkspaceSidebarState(
				workspaceModelWith({ number: 7, status: 'checking' }),
			).kind,
		).toBe('pr-checking');
		expect(
			getWorkspaceSidebarState(
				workspaceModelWith({ number: 7, status: 'ready' }),
			).kind,
		).toBe('pr-ready');
		expect(
			getWorkspaceSidebarState(
				workspaceModelWith({ number: 7, status: 'open' }),
			).kind,
		).toBe('pr-open');
	});

	test('a workspace with no PR falls back to the branch icon (not fake checks)', () => {
		const state = getWorkspaceSidebarState(workspaceModelWith(null));
		expect(state.kind).toBe('branch');
		expect(state.icon).toBe(GitBranchIcon);
	});

	test('a busy agent overrides PR state with the working spinner', () => {
		const state = getWorkspaceSidebarState(
			workspaceModelWith({ number: 7, status: 'merged' }),
			{ agentBusy: true },
		);
		expect(state.kind).toBe('workspace-working');
		expect(state.isSpinning).toBe(true);
	});
});
