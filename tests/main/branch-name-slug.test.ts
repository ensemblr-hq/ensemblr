/// <reference types="bun" />

import { describe, expect, test } from 'bun:test';

import {
	composeRenamedBranch,
	sanitizeBranchSlug,
	shouldAutoRenameWorkspace,
} from '../../src/main/pi-agent/branch-name-slug';
import { joinBranchName } from '../../src/main/repository/branch-name';

describe('composeRenamedBranch', () => {
	test('preserves a single-segment prefix', () => {
		expect(composeRenamedBranch('psoldunov/bach', 'add-dark-mode')).toBe(
			'psoldunov/add-dark-mode',
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
		expect(joinBranchName('psoldunov', 'add-dark-mode')).toBe(
			'psoldunov/add-dark-mode',
		);
	});

	test('returns the bare slug for an empty prefix', () => {
		expect(joinBranchName('', 'add-dark-mode')).toBe('add-dark-mode');
	});

	test('collapses trailing slash(es) on the prefix', () => {
		expect(joinBranchName('psoldunov/', 'fix-login')).toBe(
			'psoldunov/fix-login',
		);
		expect(joinBranchName('team/feature//', 'fix-login')).toBe(
			'team/feature/fix-login',
		);
	});
});

describe('shouldAutoRenameWorkspace', () => {
	const pass = {
		metadata: { placeholderName: true },
		prompt: 'add dark mode',
		renameEnabled: true,
	};

	test('renames an un-renamed placeholder with a prompt and the setting on', () => {
		expect(shouldAutoRenameWorkspace(pass)).toBe(true);
	});

	test('skips an empty or whitespace-only prompt', () => {
		expect(shouldAutoRenameWorkspace({ ...pass, prompt: '' })).toBe(false);
		expect(shouldAutoRenameWorkspace({ ...pass, prompt: '   ' })).toBe(false);
		expect(shouldAutoRenameWorkspace({ ...pass, prompt: undefined })).toBe(
			false,
		);
	});

	test('skips when the setting is off', () => {
		expect(shouldAutoRenameWorkspace({ ...pass, renameEnabled: false })).toBe(
			false,
		);
	});

	test('skips a non-placeholder workspace', () => {
		expect(shouldAutoRenameWorkspace({ ...pass, metadata: {} })).toBe(false);
		expect(
			shouldAutoRenameWorkspace({
				...pass,
				metadata: { placeholderName: false },
			}),
		).toBe(false);
		// Must be a strict boolean true, not a truthy string.
		expect(
			shouldAutoRenameWorkspace({
				...pass,
				metadata: { placeholderName: 'true' },
			}),
		).toBe(false);
	});

	test('skips a workspace already auto-renamed (renamedAt stamped)', () => {
		expect(
			shouldAutoRenameWorkspace({
				...pass,
				metadata: { placeholderName: true, renamedAt: '2026-06-16T00:00:00Z' },
			}),
		).toBe(false);
	});

	test('a non-string renamedAt does not block (only a string timestamp does)', () => {
		expect(
			shouldAutoRenameWorkspace({
				...pass,
				metadata: { placeholderName: true, renamedAt: 0 },
			}),
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

	test('caps length at a word boundary', () => {
		const result = sanitizeBranchSlug(
			'add a really long and very descriptive branch name here please',
		);
		expect(result).not.toBeNull();
		expect((result ?? '').length).toBeLessThanOrEqual(40);
		expect(result).not.toMatch(/-$/); // no trailing dash after truncation
	});
});
