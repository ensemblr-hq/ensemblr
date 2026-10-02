import { describe, expect, test } from 'vitest';

import {
	isBranchNameable,
	isWorkspaceNameable,
	sanitizeBranchSlug,
} from '../../src/main/agent-runtime/branch-name-slug';
import {
	branchNameFromRef,
	nextContinuationBranchName,
} from '../../src/main/repository/branch-name';
import {
	composeRenamedBranch,
	joinBranchName,
} from '../../src/shared/branch-name';

describe('composeRenamedBranch', () => {
	test('preserves a single-segment prefix', () => {
		expect(composeRenamedBranch('octocat/bach', 'add-dark-mode')).toBe(
			'octocat/add-dark-mode',
		);
	});

	test('preserves a multi-segment prefix, swapping only the last segment', () => {
		expect(composeRenamedBranch('team/feature/bach', 'fix-login')).toBe(
			'team/feature/fix-login',
		);
	});

	test('returns the bare slug when there is no prefix', () => {
		expect(composeRenamedBranch('bach', 'add-dark-mode')).toBe('add-dark-mode');
	});

	test('treats a leading-slash branch as prefix-less', () => {
		expect(composeRenamedBranch('/bach', 'fix-login')).toBe('fix-login');
	});
});

describe('joinBranchName', () => {
	test('joins a prefix and slug with a single slash', () => {
		expect(joinBranchName('octocat', 'add-dark-mode')).toBe(
			'octocat/add-dark-mode',
		);
	});

	test('returns the bare slug for an empty prefix', () => {
		expect(joinBranchName('', 'add-dark-mode')).toBe('add-dark-mode');
	});

	test('collapses trailing slash(es) on the prefix', () => {
		expect(joinBranchName('octocat/', 'fix-login')).toBe('octocat/fix-login');
		expect(joinBranchName('team/feature//', 'fix-login')).toBe(
			'team/feature/fix-login',
		);
	});
});

describe('nextContinuationBranchName', () => {
	test('appends a -v1 marker to an unmarked branch', () => {
		expect(nextContinuationBranchName('octocat/bach', [])).toBe(
			'octocat/bach-v1',
		);
	});

	test('bumps an existing marker instead of stacking a second one', () => {
		expect(nextContinuationBranchName('octocat/bach-v1', [])).toBe(
			'octocat/bach-v2',
		);
		expect(nextContinuationBranchName('octocat/bach-v9', [])).toBe(
			'octocat/bach-v10',
		);
	});

	test('skips names already taken in the repository', () => {
		expect(
			nextContinuationBranchName('octocat/bach', [
				'octocat/bach',
				'octocat/bach-v1',
				'octocat/bach-v2',
			]),
		).toBe('octocat/bach-v3');
	});

	test('bumps a branch that already ends in a dash-v version', () => {
		expect(nextContinuationBranchName('octocat/bump-eslint-v9', [])).toBe(
			'octocat/bump-eslint-v10',
		);
	});

	test('treats a non-marker v segment as part of the base name', () => {
		expect(nextContinuationBranchName('release-v', [])).toBe('release-v-v1');
		expect(nextContinuationBranchName('bump-v2-deps', [])).toBe(
			'bump-v2-deps-v1',
		);
	});

	test('leaves an over-long digit run as part of the base name', () => {
		expect(nextContinuationBranchName('epoch-v1234567890', [])).toBe(
			'epoch-v1234567890-v1',
		);
	});
});

describe('branchNameFromRef', () => {
	test('strips the local branch prefix', () => {
		expect(branchNameFromRef('refs/heads/octocat/bach')).toBe('octocat/bach');
	});

	test('strips the remote prefix and its remote segment', () => {
		expect(branchNameFromRef('refs/remotes/origin/octocat/bach')).toBe(
			'octocat/bach',
		);
		expect(branchNameFromRef('refs/remotes/upstream/bach-v1')).toBe('bach-v1');
	});

	test('claims no name for a remote HEAD pointer', () => {
		expect(branchNameFromRef('refs/remotes/origin/HEAD')).toBeNull();
	});

	test('ignores tags and other ref namespaces', () => {
		expect(branchNameFromRef('refs/tags/v1.0.0')).toBeNull();
		expect(branchNameFromRef('refs/stash')).toBeNull();
		expect(branchNameFromRef('')).toBeNull();
	});
});

describe('isWorkspaceNameable', () => {
	test('accepts an un-renamed placeholder workspace', () => {
		expect(isWorkspaceNameable({ placeholderName: true })).toBe(true);
	});

	test('rejects a workspace whose name was chosen', () => {
		expect(isWorkspaceNameable({})).toBe(false);
		expect(isWorkspaceNameable({ placeholderName: false })).toBe(false);
		// Must be a strict boolean true, not a truthy string.
		expect(isWorkspaceNameable({ placeholderName: 'true' })).toBe(false);
	});

	test('rejects a workspace already renamed (renamedAt stamped)', () => {
		expect(
			isWorkspaceNameable({
				placeholderName: true,
				renamedAt: '2026-06-16T00:00:00Z',
			}),
		).toBe(false);
	});

	test('a non-string renamedAt does not block (only a string timestamp does)', () => {
		expect(isWorkspaceNameable({ placeholderName: true, renamedAt: 0 })).toBe(
			true,
		);
	});
});

describe('isBranchNameable', () => {
	test('accepts a branch that has never been renamed', () => {
		expect(isBranchNameable({ placeholderName: true })).toBe(true);
		expect(isBranchNameable({ branchNamed: false })).toBe(true);
	});

	test('rejects a branch a rename already moved', () => {
		expect(isBranchNameable({ branchNamed: true })).toBe(false);
	});

	// The rename dialog retitles a workspace without moving its branch. Judging
	// the branch by the display name retired the one-shot for a branch still
	// carrying the slug it was cut with, which is what sent agents to
	// `git branch -m` instead.
	test('accepts the branch of a workspace the user retitled but never re-branched', () => {
		expect(
			isBranchNameable({
				branchNamed: false,
				placeholderName: true,
				renamedAt: '2026-06-16T00:00:00Z',
			}),
		).toBe(true);
	});

	test('rejects an adopted branch, which may already back a pull request', () => {
		expect(
			isBranchNameable({ adoptedBranch: true, placeholderName: true }),
		).toBe(false);
	});

	// Rows written before the flag existed were judged by the display name, and
	// that is still the only signal they carry.
	test('falls back to the display-name gate for a row predating the flag', () => {
		expect(isBranchNameable({ placeholderName: true })).toBe(true);
		expect(
			isBranchNameable({
				placeholderName: true,
				renamedAt: '2026-06-16T00:00:00Z',
			}),
		).toBe(false);
		expect(isBranchNameable({})).toBe(false);
	});

	test('reads only a strict boolean flag, never a truthy string', () => {
		expect(
			isBranchNameable({ branchNamed: 'true', placeholderName: true }),
		).toBe(true);
	});
});

describe('sanitizeBranchSlug', () => {
	test('passes through an already-clean slug', () => {
		expect(sanitizeBranchSlug('add-dark-mode')).toBe('add-dark-mode');
	});

	test('slugifies words and casing', () => {
		expect(sanitizeBranchSlug('Add Dark Mode')).toBe('add-dark-mode');
	});

	test('strips conversational prefixes', () => {
		expect(sanitizeBranchSlug('branch: fix-login')).toBe('fix-login');
		expect(sanitizeBranchSlug('Branch name: Fix Login')).toBe('fix-login');
	});

	test('strips quotes and code fences', () => {
		expect(sanitizeBranchSlug('"fix-bug"')).toBe('fix-bug');
		expect(sanitizeBranchSlug('```\nfix-bug\n```')).toBe('fix-bug');
	});

	test('uses only the first non-empty line', () => {
		expect(sanitizeBranchSlug('fix-bug\nHere is why...')).toBe('fix-bug');
	});

	test('returns null when nothing usable remains', () => {
		expect(sanitizeBranchSlug('')).toBeNull();
		expect(sanitizeBranchSlug('!!!')).toBeNull();
	});

	test('leaves no entity fragment in a slug from an encoded name', () => {
		expect(sanitizeBranchSlug('Admin &amp; Management')).toBe(
			'admin-management',
		);
		expect(sanitizeBranchSlug('Compare &lt;div&gt; output')).toBe(
			'compare-div-output',
		);
		expect(sanitizeBranchSlug('Admin &amp;amp; Management')).toBe(
			'admin-management',
		);
	});

	test('leaves no digits behind for an encoded whitespace control', () => {
		expect(sanitizeBranchSlug('Fix&#10;login')).toBe('fix-login');
		expect(sanitizeBranchSlug('Fix&#9;login')).toBe('fix-login');
	});

	test('caps length at a word boundary', () => {
		const result = sanitizeBranchSlug(
			'add a really long and very descriptive branch name here please',
		);
		expect(result).not.toBeNull();
		expect((result ?? '').length).toBeLessThanOrEqual(40);
		expect(result).not.toMatch(/-$/); // no trailing dash after truncation
	});
});
