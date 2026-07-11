import { expect, test } from 'vitest';

import { getRightSidebarHeaderState } from '../../src/renderer/components/workbench-shell/right-sidebar-header/state';
import { getDefaultWorkspace } from '../../src/renderer/fixtures/workbench';
import type { WorkspaceShellModel } from '../../src/renderer/types/workbench';

/** A no-PR workspace with the given uncommitted working-tree file count. */
function workspaceWithoutPr(files: number): WorkspaceShellModel {
	const base = getDefaultWorkspace();
	return {
		...base,
		changeSummary: { ...base.changeSummary, files },
		pullRequest: { ...base.pullRequest, number: undefined },
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
