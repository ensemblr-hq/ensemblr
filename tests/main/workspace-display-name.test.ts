import { describe, expect, test } from 'vitest';

import { deriveWorkspaceDisplayName } from '../../src/main/agent-runtime/naming/workspace-display-name';

describe('deriveWorkspaceDisplayName', () => {
	test('turns a kebab slug into words', () => {
		expect(deriveWorkspaceDisplayName('add-dark-mode')).toBe('Add dark mode');
	});

	test('keeps the casing a written name arrived with', () => {
		expect(deriveWorkspaceDisplayName('Fix the IPC handler')).toBe(
			'Fix the IPC handler',
		);
		expect(deriveWorkspaceDisplayName('Rework GitHub PR sweeping')).toBe(
			'Rework GitHub PR sweeping',
		);
	});

	test('capitalizes only the opening word', () => {
		expect(deriveWorkspaceDisplayName('rename workspace on branch')).toBe(
			'Rename workspace on branch',
		);
	});

	test('renders a lowercase initialism the way it is written', () => {
		expect(deriveWorkspaceDisplayName('fix-ipc-handler')).toBe(
			'Fix IPC handler',
		);
		expect(deriveWorkspaceDisplayName('add-mcp-tool')).toBe('Add MCP tool');
		expect(deriveWorkspaceDisplayName('linear-oauth-callback')).toBe(
			'Linear OAuth callback',
		);
	});

	test('renders an initialism that opens the name', () => {
		expect(deriveWorkspaceDisplayName('ipc-request-schemas')).toBe(
			'IPC request schemas',
		);
	});

	// Sentence case must not overwrite a spelling the table already fixed:
	// capitalizing `npm` into `Npm` manufactures a misspelling out of a term the
	// caller wrote correctly.
	test('leaves a term fixed lowercase alone when it opens the name', () => {
		expect(deriveWorkspaceDisplayName('npm install caching')).toBe(
			'npm install caching',
		);
		expect(deriveWorkspaceDisplayName('xterm webgl renderer')).toBe(
			'xterm webgl renderer',
		);
		expect(deriveWorkspaceDisplayName('npx runner flags')).toBe(
			'npx runner flags',
		);
		expect(deriveWorkspaceDisplayName('gh cli fallback')).toBe(
			'gh CLI fallback',
		);
	});

	test('leaves a term fixed lowercase alone away from the opening word', () => {
		expect(deriveWorkspaceDisplayName('speed up npm installs')).toBe(
			'Speed up npm installs',
		);
		expect(deriveWorkspaceDisplayName('cache-npm-and-npx')).toBe(
			'Cache npm and npx',
		);
	});

	// The table normalizes toward its own spelling in both directions, exactly as
	// it does for an initialism arriving as `Ipc`.
	test('normalizes a miscased term onto its fixed spelling', () => {
		expect(deriveWorkspaceDisplayName('NPM install caching')).toBe(
			'npm install caching',
		);
		expect(deriveWorkspaceDisplayName('fix Ipc handler')).toBe(
			'Fix IPC handler',
		);
	});

	// The guard on the fix: sentence case still applies to every word the table
	// does not fix.
	test('still sentence-cases an opening word the table does not fix', () => {
		expect(deriveWorkspaceDisplayName('add-dark-mode')).toBe('Add dark mode');
		expect(deriveWorkspaceDisplayName('rework github sweeping')).toBe(
			'Rework github sweeping',
		);
	});

	test('treats every slug separator as a word break', () => {
		expect(deriveWorkspaceDisplayName('add_dark_mode')).toBe('Add dark mode');
		expect(deriveWorkspaceDisplayName('octocat/add-dark-mode')).toBe(
			'Octocat add dark mode',
		);
	});

	// A name leading with a dot is rejected by the rename service, and a name
	// carrying `..` reads as a path rather than as work.
	test('leaves no path fragment in a name derived from a traversal', () => {
		expect(deriveWorkspaceDisplayName('../../etc/passwd')).toBe('Etc passwd');
	});

	test('strips the label and quoting an LLM wraps an answer in', () => {
		expect(deriveWorkspaceDisplayName('branch: add-dark-mode')).toBe(
			'Add dark mode',
		);
		expect(deriveWorkspaceDisplayName('"Add dark mode"')).toBe('Add dark mode');
	});

	test('takes the first content line', () => {
		expect(deriveWorkspaceDisplayName('Add dark mode\n\nthen ship it')).toBe(
			'Add dark mode',
		);
	});

	test('drops characters a workspace name may not carry', () => {
		expect(deriveWorkspaceDisplayName('feat(theme): add dark mode')).toBe(
			'Feat theme add dark mode',
		);
	});

	test('shortens an overlong name at a word boundary', () => {
		const name = deriveWorkspaceDisplayName(`${'alpha '.repeat(30)}omega`);
		expect(name).not.toBeNull();
		expect((name ?? '').length).toBeLessThanOrEqual(100);
		expect(name).not.toMatch(/\s$/);
		expect(name).toMatch(/alpha$/);
	});

	test('returns null when nothing usable survives', () => {
		expect(deriveWorkspaceDisplayName('')).toBeNull();
		expect(deriveWorkspaceDisplayName('   \n  ')).toBeNull();
		expect(deriveWorkspaceDisplayName('!!! ???')).toBeNull();
	});
});
