import { expect, test } from 'vitest';

import { getDefaultWorkspace } from '../../src/renderer/fixtures/workbench';
import { getRightSidebarHeaderState } from '../../src/renderer/lib/workbench/right-sidebar-header-state';
import type { WorkspaceShellModel } from '../../src/renderer/types/workbench';

/** A no-PR workspace with the given uncommitted working-tree file count. */
function workspaceWithoutPr(files: number): WorkspaceShellModel {
	const base = getDefaultWorkspace();
	return {
		...base,
		changeSummary: { ...base.changeSummary, files },
		pullRequest: { ...base.pullRequest, number: undefined, status: 'idle' },
	};
}

/** A workspace whose open PR carries the given pull-request overrides. */
function workspaceWithPr(
	overrides: Partial<WorkspaceShellModel['pullRequest']>,
): WorkspaceShellModel {
	const base = getDefaultWorkspace();
	return {
		...base,
		pullRequest: {
			...base.pullRequest,
			number: 118,
			state: 'open',
			status: 'idle',
			...overrides,
		},
	};
}

test('no PR + branch has changes → Create PR, even with a clean worktree', () => {
	// The bug: committed-on-branch edits leave the worktree clean (files: 0), so
	// the old changeSummary-only gate hid Create PR. The branch signal restores it.
	const state = getRightSidebarHeaderState(workspaceWithoutPr(0), true);
	expect(state.kind).toBe('create-pr');
});

test('no PR + branch has no changes → empty header action', () => {
	const state = getRightSidebarHeaderState(workspaceWithoutPr(3), false);
	expect(state.kind).toBe('empty');
});

test('no PR, no branch signal → falls back to the working-tree count', () => {
	expect(getRightSidebarHeaderState(workspaceWithoutPr(2)).kind).toBe(
		'create-pr',
	);
	expect(getRightSidebarHeaderState(workspaceWithoutPr(0)).kind).toBe('empty');
});

test('an open PR ignores the branch-changes signal', () => {
	const base = getDefaultWorkspace();
	const withPr: WorkspaceShellModel = {
		...base,
		pullRequest: { ...base.pullRequest, number: 42, status: 'idle' },
	};
	expect(getRightSidebarHeaderState(withPr, false).kind).not.toBe('empty');
	expect(getRightSidebarHeaderState(withPr, false).kind).not.toBe('create-pr');
});

test('an open PR with no status to report stays blank, never showing its title', () => {
	const base = getDefaultWorkspace();
	const withUnlabelledPr: WorkspaceShellModel = {
		...base,
		pullRequest: {
			...base.pullRequest,
			label: '',
			number: 118,
			state: 'open',
			status: 'idle',
			title: 'ENG-118 Wire Linear issue flow',
		},
	};

	expect(getRightSidebarHeaderState(withUnlabelledPr, false)).toMatchObject({
		kind: 'pr-open',
		label: '',
	});
});

test('an open PR keeps the status label the gh snapshot derived', () => {
	const base = getDefaultWorkspace();
	const withDraftPr: WorkspaceShellModel = {
		...base,
		pullRequest: {
			...base.pullRequest,
			label: 'Draft',
			number: 118,
			state: 'open',
			status: 'idle',
			title: 'ENG-118 Wire Linear issue flow',
		},
	};

	expect(getRightSidebarHeaderState(withDraftPr, false)).toMatchObject({
		kind: 'pr-open',
		label: 'Draft',
	});
});

test('a merged PR uses the post-merge header actions', () => {
	const base = getDefaultWorkspace();
	const withMergedPr: WorkspaceShellModel = {
		...base,
		pullRequest: {
			...base.pullRequest,
			label: 'Merged',
			number: 42,
			state: 'merged',
			status: 'idle',
		},
	};
	const state = getRightSidebarHeaderState(withMergedPr, false);

	expect(state.kind).toBe('pr-merged');
	expect(state.tone).toBe('merged');
});

test('a merged PR keeps its preview deployment link', () => {
	const base = getDefaultWorkspace();
	const previewDeployment = {
		label: 'Preview',
		provider: 'vercel',
		source: 'github-deployment',
		status: 'ready',
		url: 'https://ready-preview.vercel.app',
	} as const;
	const withMergedPr: WorkspaceShellModel = {
		...base,
		pullRequest: {
			...base.pullRequest,
			label: 'Merged',
			number: 42,
			previewDeployment,
			state: 'merged',
			status: 'idle',
		},
	};

	expect(getRightSidebarHeaderState(withMergedPr, false)).toMatchObject({
		kind: 'pr-merged',
		previewDeployment,
		tone: 'merged',
	});
});

test('a continued merged PR behaves like a brand-new workspace header', () => {
	const base = getDefaultWorkspace();
	const withMergedPr: WorkspaceShellModel = {
		...base,
		pullRequest: {
			...base.pullRequest,
			number: 42,
			state: 'merged',
			status: 'idle',
		},
	};

	expect(
		getRightSidebarHeaderState(withMergedPr, true, {
			continuedPullRequestNumber: 42,
		}).kind,
	).toBe('create-pr');
	expect(
		getRightSidebarHeaderState(withMergedPr, false, {
			continuedPullRequestNumber: 42,
		}).kind,
	).toBe('empty');
});

test('an agent turn freezes the header without erasing the PR status', () => {
	const blockedPr = workspaceWithPr({
		label: '2 checks failing',
		status: 'blocked',
	});

	expect(
		getRightSidebarHeaderState(blockedPr, false, { agentBusy: true }),
	).toMatchObject({
		isAgentWorking: true,
		kind: 'pr-blocked',
		label: '2 checks failing',
		tone: 'blocked',
	});
});

test('a PR with no status to report falls back to Working... while busy', () => {
	const quietPr = workspaceWithPr({ label: '', title: 'ENG-118 Wire Linear' });

	expect(
		getRightSidebarHeaderState(quietPr, false, { agentBusy: true }),
	).toMatchObject({
		isAgentWorking: true,
		kind: 'pr-open',
		label: 'Working...',
	});
});

test('a busy workspace with no PR still reports Working...', () => {
	expect(
		getRightSidebarHeaderState(workspaceWithoutPr(3), true, {
			agentBusy: true,
		}),
	).toMatchObject({
		isAgentWorking: true,
		kind: 'create-pr',
		label: 'Working...',
	});
	expect(
		getRightSidebarHeaderState(workspaceWithoutPr(0), false, {
			agentBusy: true,
		}),
	).toMatchObject({
		isAgentWorking: true,
		kind: 'empty',
		label: 'Working...',
	});
});

test('an idle workspace carries no working label', () => {
	expect(
		getRightSidebarHeaderState(workspaceWithoutPr(0), false),
	).toMatchObject({ isAgentWorking: false, kind: 'empty', label: '' });
});

test('the agent-working PR status still sets the busy flag on its own', () => {
	expect(
		getRightSidebarHeaderState(
			workspaceWithPr({ label: '', status: 'agent-working' }),
			false,
		),
	).toMatchObject({ isAgentWorking: true, label: 'Working...' });
});

test('an uncommitted worktree outranks the PR status it would report on', () => {
	const dirtyBlockedPr = workspaceWithPr({
		gitStatus: {
			actionLabel: 'Commit and push',
			kind: 'uncommitted',
			label: '3 uncommitted changes',
			status: 'pending',
		},
		label: '2 checks failing',
		status: 'blocked',
	});

	expect(getRightSidebarHeaderState(dirtyBlockedPr, false)).toMatchObject({
		kind: 'pr-uncommitted',
		label: '3 uncommitted changes',
		tone: 'pending',
	});
});

test('unpushed commits outrank a ready-to-merge PR', () => {
	const unpushedReadyPr = workspaceWithPr({
		gitStatus: {
			actionLabel: 'Push',
			kind: 'unpushed',
			label: '2 unpushed commits',
			status: 'pending',
		},
		label: 'Ready to merge',
		status: 'ready-to-merge',
	});

	expect(getRightSidebarHeaderState(unpushedReadyPr, false)).toMatchObject({
		kind: 'pr-unpushed',
		label: '2 unpushed commits',
		tone: 'pending',
	});
});

test('a branch with no upstream resolves to the same push action', () => {
	const unpublishedPr = workspaceWithPr({
		gitStatus: {
			actionLabel: 'Push branch',
			kind: 'unpublished',
			label: 'Branch not pushed yet',
			status: 'pending',
		},
	});

	expect(getRightSidebarHeaderState(unpublishedPr, false).kind).toBe(
		'pr-unpushed',
	);
});

test('a trial-merge conflict blocks the header before gh has caught up', () => {
	const quietPr = workspaceWithPr({ label: '', status: 'idle' });

	expect(
		getRightSidebarHeaderState(quietPr, false, { hasConflicts: true }),
	).toMatchObject({
		hasConflicts: true,
		kind: 'pr-blocked',
		label: 'Merge conflicts',
		tone: 'blocked',
	});
});

test('either conflict source alone blocks the header', () => {
	const githubOnly = workspaceWithPr({ isConflicting: true, label: '' });

	expect(getRightSidebarHeaderState(githubOnly, false)).toMatchObject({
		hasConflicts: true,
		kind: 'pr-blocked',
		label: 'Merge conflicts',
	});
});

test('a conflict outranks a ready-to-merge verdict it makes moot', () => {
	const conflictingReadyPr = workspaceWithPr({
		label: 'Ready to merge',
		status: 'ready-to-merge',
	});

	expect(
		getRightSidebarHeaderState(conflictingReadyPr, false, {
			hasConflicts: true,
		}).kind,
	).toBe('pr-blocked');
});

test('an uncommitted worktree still outranks a conflict it has to be committed to fix', () => {
	const dirtyConflictingPr = workspaceWithPr({
		gitStatus: {
			actionLabel: 'Commit and push',
			kind: 'uncommitted',
			label: '3 uncommitted changes',
			status: 'pending',
		},
	});

	expect(
		getRightSidebarHeaderState(dirtyConflictingPr, false, {
			hasConflicts: true,
		}),
	).toMatchObject({ hasConflicts: true, kind: 'pr-uncommitted' });
});

test('a branch with no PR yet still reports its conflicts', () => {
	expect(
		getRightSidebarHeaderState(workspaceWithoutPr(3), true, {
			hasConflicts: true,
		}),
	).toMatchObject({
		hasConflicts: true,
		kind: 'create-pr',
		label: 'Merge conflicts',
		tone: 'blocked',
	});
});

test('a conflict outranks the working label, which has nothing to report', () => {
	expect(
		getRightSidebarHeaderState(workspaceWithoutPr(3), true, {
			agentBusy: true,
			hasConflicts: true,
		}),
	).toMatchObject({
		isAgentWorking: true,
		label: 'Merge conflicts',
	});
});

test('a clean branch carries no conflict flag', () => {
	expect(
		getRightSidebarHeaderState(workspaceWithoutPr(0), false),
	).toMatchObject({ hasConflicts: false });
	expect(getRightSidebarHeaderState(workspaceWithPr({}), false)).toMatchObject({
		hasConflicts: false,
	});
});

test('a merged PR keeps its post-merge header over a dirty worktree', () => {
	const dirtyMergedPr = workspaceWithPr({
		gitStatus: {
			actionLabel: 'Commit and push',
			kind: 'uncommitted',
			label: '3 uncommitted changes',
			status: 'pending',
		},
		label: 'Merged',
		state: 'merged',
	});

	expect(getRightSidebarHeaderState(dirtyMergedPr, false)).toMatchObject({
		kind: 'pr-merged',
		tone: 'merged',
	});
});
