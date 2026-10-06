import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
	readStagedAgentMods,
	stageAgentMods,
} from '../../src/main/agent-skills/mods-staging.ts';

/**
 * Writes a minimal mods plugin, plus test-only files that must never ship.
 * @param root - Directory to write it into.
 * @param hook - Body of the one hook module, so a test can change what ships.
 */
const writeModsPlugin = (root: string, hook = 'export default {};\n'): void => {
	mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
	mkdirSync(path.join(root, 'hooks'), { recursive: true });
	mkdirSync(path.join(root, 'tests'), { recursive: true });
	writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), '{}\n');
	writeFileSync(path.join(root, 'hooks', 'hooks.json'), '{}\n');
	writeFileSync(path.join(root, 'hooks', 'mod.ts'), hook);
	writeFileSync(path.join(root, 'hooks', 'mod.test.ts'), 'test one\n');
	writeFileSync(path.join(root, 'tests', 'suite.ts'), 'test two\n');
};

/**
 * Writes what Claude Code itself lays into a plugin folder it loads.
 * @param root - Plugin root to write into.
 */
const writeEngineFiles = (root: string): void => {
	mkdirSync(path.join(root, '.claude-plugin', 'types'), { recursive: true });
	writeFileSync(
		path.join(root, '.claude-plugin', 'types', 'hooks.d.ts'),
		'export {};\n',
	);
	writeFileSync(path.join(root, 'tsconfig.json'), '{}\n');
};

/** A fresh scratch directory for one staging test. */
const scratch = (): string =>
	mkdtempSync(path.join(tmpdir(), 'ensemblr-mods-staging-'));

/**
 * Lists every file under a directory, relative to it.
 * @param root - Directory to list.
 * @returns POSIX-style relative paths, sorted.
 */
const listFiles = (root: string): string[] =>
	readdirSync(root, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) =>
			path
				.relative(root, path.join(entry.parentPath, entry.name))
				.split(path.sep)
				.join('/'),
		)
		.sort();

describe('stageAgentMods', () => {
	it('copies what ships into a content-hashed directory, leaving tests behind', () => {
		const source = path.join(scratch(), 'agent-mods');
		writeModsPlugin(source);
		const parent = path.join(scratch(), 'claude-mods');

		const staged = stageAgentMods(source, parent);

		expect(path.dirname(staged)).toBe(parent);
		expect(path.basename(staged)).toMatch(/^[0-9a-f]{16}$/);
		expect(listFiles(staged)).toEqual([
			'.claude-plugin/plugin.json',
			'hooks/hooks.json',
			'hooks/mod.ts',
		]);
	});

	it('hashes only what ships, so a test-only change keeps the same copy', () => {
		const source = path.join(scratch(), 'agent-mods');
		writeModsPlugin(source);
		const parent = path.join(scratch(), 'claude-mods');
		const before = stageAgentMods(source, parent);

		writeFileSync(path.join(source, 'tests', 'suite.ts'), 'changed\n');
		writeFileSync(path.join(source, 'hooks', 'mod.test.ts'), 'changed\n');

		expect(stageAgentMods(source, parent)).toBe(before);
	});

	it('ignores what Claude Code writes into a source it once loaded in place', () => {
		const source = path.join(scratch(), 'agent-mods');
		writeModsPlugin(source);
		const parent = path.join(scratch(), 'claude-mods');
		const before = stageAgentMods(source, parent);

		writeEngineFiles(source);
		const after = stageAgentMods(source, parent);

		expect(after).toBe(before);
		expect(listFiles(after)).not.toContain('tsconfig.json');
	});

	it('moves to a new copy when a shipped file changes', () => {
		const source = path.join(scratch(), 'agent-mods');
		writeModsPlugin(source);
		const parent = path.join(scratch(), 'claude-mods');
		const before = stageAgentMods(source, parent);

		writeModsPlugin(source, 'export default { changed: true };\n');

		expect(stageAgentMods(source, parent)).not.toBe(before);
	});

	it('reuses a copy already staged, keeping what Claude wrote into it', () => {
		const source = path.join(scratch(), 'agent-mods');
		writeModsPlugin(source);
		const parent = path.join(scratch(), 'claude-mods');
		const staged = stageAgentMods(source, parent);
		writeEngineFiles(staged);

		expect(stageAgentMods(source, parent)).toBe(staged);
		expect(existsSync(path.join(staged, 'tsconfig.json'))).toBe(true);
		expect(
			existsSync(path.join(staged, '.claude-plugin', 'types', 'hooks.d.ts')),
		).toBe(true);
	});

	it('replaces a copy whose shipped content was edited, leaving no sibling behind', () => {
		const source = path.join(scratch(), 'agent-mods');
		writeModsPlugin(source);
		const parent = path.join(scratch(), 'claude-mods');
		const staged = stageAgentMods(source, parent);
		writeFileSync(path.join(staged, 'hooks', 'mod.ts'), 'tampered\n');
		writeFileSync(path.join(staged, 'hooks', 'extra.ts'), 'injected\n');

		expect(stageAgentMods(source, parent)).toBe(staged);
		expect(readFileSync(path.join(staged, 'hooks', 'mod.ts'), 'utf8')).toBe(
			'export default {};\n',
		);
		expect(existsSync(path.join(staged, 'hooks', 'extra.ts'))).toBe(false);
		expect(readdirSync(parent)).toEqual([path.basename(staged)]);
	});

	it('removes sibling copies untouched for a day and keeps recent ones', () => {
		const source = path.join(scratch(), 'agent-mods');
		writeModsPlugin(source);
		const parent = path.join(scratch(), 'claude-mods');
		const stale = path.join(parent, '0000000000000000');
		const recent = path.join(parent, '1111111111111111');
		mkdirSync(stale, { recursive: true });
		mkdirSync(recent, { recursive: true });
		const now = Date.now();
		const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000);
		utimesSync(stale, twoDaysAgo, twoDaysAgo);

		const staged = stageAgentMods(source, parent, now);

		expect(existsSync(stale)).toBe(false);
		expect(existsSync(recent)).toBe(true);
		expect(statSync(staged).mtimeMs).toBe(now);
	});
});

describe('readStagedAgentMods', () => {
	it('stages the first complete candidate once per process', () => {
		const incomplete = path.join(scratch(), 'agent-mods');
		mkdirSync(path.join(incomplete, '.claude-plugin'), { recursive: true });
		writeFileSync(path.join(incomplete, '.claude-plugin', 'plugin.json'), '{}');
		const source = path.join(scratch(), 'agent-mods');
		writeModsPlugin(source);
		const parent = path.join(scratch(), 'claude-mods');

		const staged = readStagedAgentMods([incomplete, source], parent);
		writeModsPlugin(source, 'export default { later: true };\n');

		expect(staged).not.toBeNull();
		expect(readStagedAgentMods([incomplete, source], parent)).toBe(staged);
		expect(readdirSync(parent)).toHaveLength(1);
	});

	it('touches the memoized copy on every call, so the prune never takes it', () => {
		const source = path.join(scratch(), 'agent-mods');
		writeModsPlugin(source);
		const parent = path.join(scratch(), 'claude-mods');
		const staged = readStagedAgentMods([source], parent) as string;
		const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
		utimesSync(staged, twoDaysAgo, twoDaysAgo);

		expect(readStagedAgentMods([source], parent)).toBe(staged);
		expect(statSync(staged).mtimeMs).toBeGreaterThan(twoDaysAgo.getTime());
	});

	it('stages again when the memoized copy was deleted', () => {
		const source = path.join(scratch(), 'agent-mods');
		writeModsPlugin(source);
		const parent = path.join(scratch(), 'claude-mods');
		const staged = readStagedAgentMods([source], parent) as string;
		rmSync(staged, { force: true, recursive: true });

		expect(readStagedAgentMods([source], parent)).toBe(staged);
		expect(listFiles(staged)).toEqual([
			'.claude-plugin/plugin.json',
			'hooks/hooks.json',
			'hooks/mod.ts',
		]);
	});

	it('replaces a memoized copy that was edited since it was staged', () => {
		const source = path.join(scratch(), 'agent-mods');
		writeModsPlugin(source);
		const parent = path.join(scratch(), 'claude-mods');
		const staged = readStagedAgentMods([source], parent) as string;
		writeFileSync(path.join(staged, 'hooks', 'mod.ts'), 'tampered\n');

		expect(readStagedAgentMods([source], parent)).toBe(staged);
		expect(readFileSync(path.join(staged, 'hooks', 'mod.ts'), 'utf8')).toBe(
			'export default {};\n',
		);
	});

	it('contributes nothing when no candidate holds the hook registry', () => {
		const source = path.join(scratch(), 'agent-mods');
		mkdirSync(path.join(source, '.claude-plugin'), { recursive: true });
		writeFileSync(path.join(source, '.claude-plugin', 'plugin.json'), '{}');

		expect(
			readStagedAgentMods([source], path.join(scratch(), 'claude-mods')),
		).toBeNull();
	});

	it('contributes nothing, logs, and retries on the next call when the copy cannot be written', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = path.join(scratch(), 'agent-mods');
		writeModsPlugin(source);
		const blocked = path.join(scratch(), 'not-a-directory');
		writeFileSync(blocked, 'a file where the staging parent should be');

		try {
			expect(readStagedAgentMods([source], blocked)).toBeNull();
			expect(warn).toHaveBeenCalled();
			rmSync(blocked);
			const staged = readStagedAgentMods([source], blocked);
			expect(staged).not.toBeNull();
			expect(path.dirname(staged as string)).toBe(blocked);
		} finally {
			warn.mockRestore();
		}
	});
});
