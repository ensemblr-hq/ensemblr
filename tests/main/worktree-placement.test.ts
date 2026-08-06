import { expect, test } from 'vitest';

import { readWorktreePathForBranch } from '../../src/main/repository/worktree-placement';

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
	expect(readWorktreePathForBranch(PORCELAIN, 'feature-x')).toBe(
		'/repos/app-workspaces/app/bach',
	);
	expect(readWorktreePathForBranch(PORCELAIN, 'main')).toBe('/repos/app');
});

test('returns null for a branch no worktree holds', () => {
	expect(readWorktreePathForBranch(PORCELAIN, 'feature-y')).toBeNull();
});

test('does not match a branch whose name only prefixes a held one', () => {
	expect(readWorktreePathForBranch(PORCELAIN, 'feature')).toBeNull();
});

test('matches nested branch names in full', () => {
	const stdout = [
		'worktree /repos/app-workspaces/app/ravel',
		'branch refs/heads/psoldunov/feat/nested',
		'',
	].join('\n');

	expect(readWorktreePathForBranch(stdout, 'psoldunov/feat/nested')).toBe(
		'/repos/app-workspaces/app/ravel',
	);
	expect(readWorktreePathForBranch(stdout, 'nested')).toBeNull();
});

test('ignores a detached worktree and empty output', () => {
	expect(readWorktreePathForBranch('', 'main')).toBeNull();
	expect(
		readWorktreePathForBranch('worktree /repos/app\ndetached\n', 'main'),
	).toBeNull();
});
