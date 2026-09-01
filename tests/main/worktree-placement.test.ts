import { expect, test } from 'vitest';

import { readWorktreeHolderForBranch } from '../../src/main/repository/worktree-placement';

const PORCELAIN = [
	'worktree /repos/app',
	'HEAD 1111111111111111111111111111111111111111',
	'branch refs/heads/main',
	'',
	'worktree /repos/app-workspaces/app/bach',
	'HEAD 2222222222222222222222222222222222222222',
	'branch refs/heads/feature-x',
	'',
	'worktree /repos/app-workspaces/app/mahler',
	'HEAD 3333333333333333333333333333333333333333',
	'detached',
	'',
].join('\n');

test('finds the worktree holding a branch', () => {
	expect(readWorktreeHolderForBranch(PORCELAIN, 'feature-x')).toEqual({
		path: '/repos/app-workspaces/app/bach',
		prunable: false,
	});
	expect(readWorktreeHolderForBranch(PORCELAIN, 'main')).toEqual({
		path: '/repos/app',
		prunable: false,
	});
});

test('returns null for a branch no worktree holds', () => {
	expect(readWorktreeHolderForBranch(PORCELAIN, 'feature-y')).toBeNull();
});

test('does not match a branch whose name only prefixes a held one', () => {
	expect(readWorktreeHolderForBranch(PORCELAIN, 'feature')).toBeNull();
});

test('matches nested branch names in full', () => {
	const stdout = [
		'worktree /repos/app-workspaces/app/ravel',
		'branch refs/heads/octocat/feat/nested',
		'',
	].join('\n');

	expect(readWorktreeHolderForBranch(stdout, 'octocat/feat/nested')).toEqual({
		path: '/repos/app-workspaces/app/ravel',
		prunable: false,
	});
	expect(readWorktreeHolderForBranch(stdout, 'nested')).toBeNull();
});

test('ignores a detached worktree and empty output', () => {
	expect(readWorktreeHolderForBranch('', 'main')).toBeNull();
	expect(
		readWorktreeHolderForBranch('worktree /repos/app\ndetached\n', 'main'),
	).toBeNull();
});

test('reports a holder git marked prunable, which git writes after the branch', () => {
	const stdout = [
		'worktree /repos/app-workspaces/app/xarhakos',
		'HEAD 4444444444444444444444444444444444444444',
		'branch refs/heads/feature-gone',
		'prunable gitdir file points to non-existent location',
		'',
	].join('\n');

	expect(readWorktreeHolderForBranch(stdout, 'feature-gone')).toEqual({
		path: '/repos/app-workspaces/app/xarhakos',
		prunable: true,
	});
});

test('reports a bare prunable annotation', () => {
	const stdout = [
		'worktree /repos/app-workspaces/app/xarhakos',
		'branch refs/heads/feature-gone',
		'prunable',
		'',
	].join('\n');

	expect(readWorktreeHolderForBranch(stdout, 'feature-gone')?.prunable).toBe(
		true,
	);
});

test('does not leak a prunable annotation across record boundaries', () => {
	const stdout = [
		'worktree /repos/app-workspaces/app/xarhakos',
		'branch refs/heads/feature-gone',
		'prunable gitdir file points to non-existent location',
		'',
		'worktree /repos/app-workspaces/app/bach',
		'branch refs/heads/feature-x',
		'',
	].join('\n');

	expect(readWorktreeHolderForBranch(stdout, 'feature-x')).toEqual({
		path: '/repos/app-workspaces/app/bach',
		prunable: false,
	});
});

test('treats a locked worktree as a live holder', () => {
	const stdout = [
		'worktree /repos/app-workspaces/app/bach',
		'branch refs/heads/feature-x',
		'locked on a removable drive',
		'',
	].join('\n');

	expect(readWorktreeHolderForBranch(stdout, 'feature-x')).toEqual({
		path: '/repos/app-workspaces/app/bach',
		prunable: false,
	});
});
