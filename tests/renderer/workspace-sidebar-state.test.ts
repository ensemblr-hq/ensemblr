import {
	ArrowUpIcon,
	GitBranchIcon,
	GitMergeIcon,
	GitPullRequestArrowIcon,
} from 'lucide-react';
import { describe, expect, test } from 'vitest';

import { mapNavigationSnapshotToProjects } from '../../src/renderer/lib/workbench';
import { getWorkspaceSidebarState } from '../../src/renderer/lib/workbench/workspace-sidebar-state';
import type { WorkspaceShellModel } from '../../src/renderer/types/workbench';
import type { GitBranchSyncWire } from '../../src/shared/ipc/contracts/github';
import type {
	RepositoryWorkspaceNavigationSnapshot,
	WorkspacePrPresentation,
} from '../../src/shared/ipc/contracts/repository-navigation';

/** A branch level with its upstream, which is what a pushed PR branch looks like. */
const SYNCED_BRANCH: GitBranchSyncWire = {
	ahead: 0,
	behind: 0,
	branchName: 'feature',
	hasUpstream: true,
};

function workspaceModelWith(
	presentation:
		| (Omit<WorkspacePrPresentation, 'branchSync' | 'syncedAt'> & {
				branchSync?: GitBranchSyncWire | null;
		  })
		| null,
): WorkspaceShellModel {
	const pullRequest = presentation
		? {
				branchSync: presentation.branchSync ?? SYNCED_BRANCH,
				number: presentation.number,
				status: presentation.status,
				syncedAt: '2026-07-15T00:00:00.000Z',
			}
		: null;
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

	test('a ready PR whose branch has unpushed commits reports unpushed work', () => {
		const state = getWorkspaceSidebarState(
			workspaceModelWith({
				branchSync: { ...SYNCED_BRANCH, ahead: 2 },
				number: 7,
				status: 'ready',
			}),
		);
		expect(state.kind).toBe('pr-unpushed');
		expect(state.icon).toBe(ArrowUpIcon);
		expect(state.className).toContain('status-warning');
	});

	test('a ready PR on a branch with no upstream reports unpushed work', () => {
		const state = getWorkspaceSidebarState(
			workspaceModelWith({
				branchSync: { ...SYNCED_BRANCH, hasUpstream: false },
				number: 7,
				status: 'ready',
			}),
		);
		expect(state.kind).toBe('pr-unpushed');
		expect(state.icon).toBe(ArrowUpIcon);
	});

	test('a ready PR with uncommitted worktree edits reports unpushed work', () => {
		const ready = workspaceModelWith({ number: 7, status: 'ready' });
		const state = getWorkspaceSidebarState({
			...ready,
			pullRequest: {
				...ready.pullRequest,
				gitStatus: {
					...ready.pullRequest.gitStatus,
					kind: 'uncommitted',
				},
			},
		});
		expect(state.kind).toBe('pr-unpushed');
		expect(state.icon).toBe(ArrowUpIcon);
	});

	// The row's `changeSummary` is a `baseRef..HEAD` diff, so every PR row has a
	// non-zero file count. Reading it as uncommitted work made `pr-ready`
	// unreachable on every row and board card.
	test('a pushed ready PR keeps the ready icon however large its branch diff', () => {
		const ready = workspaceModelWith({ number: 7, status: 'ready' });
		const state = getWorkspaceSidebarState({
			...ready,
			changeSummary: { additions: 628, deletions: 31, files: 21 },
		});
		expect(state.kind).toBe('pr-ready');
		expect(state.icon).toBe(GitPullRequestArrowIcon);
	});

	test('a ready PR with a clean branch keeps the ready-to-merge icon', () => {
		const state = getWorkspaceSidebarState(
			workspaceModelWith({ number: 7, status: 'ready' }),
		);
		expect(state.kind).toBe('pr-ready');
		expect(state.icon).toBe(GitPullRequestArrowIcon);
	});

	test('unsent work does not soften a blocked PR into unpushed work', () => {
		const state = getWorkspaceSidebarState(
			workspaceModelWith({
				branchSync: { ...SYNCED_BRANCH, ahead: 2 },
				number: 7,
				status: 'blocked',
			}),
		);
		expect(state.kind).toBe('pr-blocked');
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

	test('a running archive outranks the PR verdict and the agent spinner', () => {
		const state = getWorkspaceSidebarState(
			workspaceModelWith({ number: 7, status: 'merged' }),
			{ agentBusy: true, lifecycleRun: 'archiving' },
		);
		expect(state.kind).toBe('workspace-archiving');
		expect(state.isSpinning).toBe(true);
	});

	test('a running archive outranks a pending creation', () => {
		const state = getWorkspaceSidebarState(
			{ ...workspaceModelWith(null), isPendingCreation: true },
			{ lifecycleRun: 'archiving' },
		);
		expect(state.kind).toBe('workspace-archiving');
	});

	test('a running delete reports its own kind rather than the archive one', () => {
		const state = getWorkspaceSidebarState(workspaceModelWith(null), {
			lifecycleRun: 'deleting',
		});
		expect(state.kind).toBe('workspace-deleting');
		expect(state.isSpinning).toBe(true);
	});

	test('an idle workspace is unaffected by the lifecycle-run option', () => {
		expect(
			getWorkspaceSidebarState(workspaceModelWith(null), {
				lifecycleRun: null,
			}).kind,
		).toBe('branch');
	});
});
