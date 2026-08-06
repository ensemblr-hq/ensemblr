import { expect, test } from 'vitest';

import { validateWorkspaceName } from '../../src/main/repository/workspace-validation.ts';
import { toWorkspaceDisplayName } from '../../src/shared/workspace-name.ts';

/** Asserts a candidate survives the service-side name rules. */
function expectAccepted(name: string | null): void {
	expect(name).not.toBeNull();
	expect(validateWorkspaceName(String(name))).toEqual({ valid: true });
}

test('keeps an already-valid name untouched', () => {
	expect(toWorkspaceDisplayName('Add dark mode')).toBe('Add dark mode');
	expect(toWorkspaceDisplayName('fix-the_thing.v2')).toBe('fix-the_thing.v2');
});

test('turns a slashed branch name into an accepted display name', () => {
	const name = toWorkspaceDisplayName('psoldunov/feature-x');

	expect(name).toBe('psoldunov feature-x');
	expectAccepted(name);
});

test('turns a conventional-commit pull-request title into an accepted name', () => {
	const name = toWorkspaceDisplayName(
		'feat(agent-control): unbounded ask_user_question & canonical arg names',
	);

	expect(name).toBe(
		'feat agent-control unbounded ask_user_question canonical arg names',
	);
	expectAccepted(name);
});

test('collapses runs of disallowed characters into one space', () => {
	expect(toWorkspaceDisplayName('[WIP] fix:: the //thing')).toBe(
		'WIP fix the thing',
	);
});

test('strips leading dots the service rejects outright', () => {
	expectAccepted(toWorkspaceDisplayName('.github/workflows'));
	expect(toWorkspaceDisplayName('.github/workflows')).toBe('github workflows');
});

test('truncates an over-long title back to the last whole word', () => {
	const name = toWorkspaceDisplayName(`${'a'.repeat(98)} tail end`);

	expect(name).toBe('a'.repeat(98));
	expectAccepted(name);
});

test('hard-cuts a single token that has no word boundary to fall back to', () => {
	const name = toWorkspaceDisplayName('b'.repeat(140));

	expect(name).toBe('b'.repeat(100));
	expectAccepted(name);
});

test.each([
	['empty input', ''],
	['whitespace only', '   '],
	['punctuation only', '///'],
	['a lone dot', '.'],
	['a double dot', '..'],
	['emoji only', '🚀🚀'],
])('returns null for %s so the caller falls back', (_label, raw) => {
	expect(toWorkspaceDisplayName(raw)).toBeNull();
});
