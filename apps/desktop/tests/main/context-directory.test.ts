/// <reference types="node" />

import assert from 'node:assert/strict';
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	ensureContextPath,
	resolveContextPath,
} from '../../src/main/config/context-directory.ts';
import {
	readSetupStateFile,
	writeSetupStateFile,
} from '../../src/main/scripts/setup-state-file.ts';
import {
	deleteTerminalOutput,
	readTerminalOutput,
	writeTerminalOutput,
} from '../../src/main/terminal/terminal-output-file.ts';
import type { WorkspaceSetupState } from '../../src/shared/scripts/setup-state.ts';

const SETUP_STATE: WorkspaceSetupState = {
	command: 'npm install',
	completedAt: '2026-09-12T00:00:00.000Z',
	fingerprint: 'abc123',
};

function createDirectory(t: TestContext, prefix: string): string {
	const directory = mkdtempSync(path.join(tmpdir(), prefix));
	t.after(() => rmSync(directory, { force: true, recursive: true }));

	return directory;
}

test('resolveContextPath composes a path under .context', (t) => {
	const worktree = createDirectory(t, 'ensemblr-ctx-');

	assert.equal(
		resolveContextPath(worktree, 'terminals', 'a.log'),
		path.join(worktree, '.context', 'terminals', 'a.log'),
	);
});

test('resolveContextPath refuses a traversal segment instead of collapsing it', (t) => {
	const worktree = createDirectory(t, 'ensemblr-ctx-');

	assert.equal(resolveContextPath(worktree, '../../../etc/passwd.log'), null);
	assert.equal(resolveContextPath(worktree, 'a/../../../x'), null);
	assert.equal(resolveContextPath(worktree, '..'), null);
});

test('ensureContextPath refuses a worktree whose .context is a committed symlink', (t) => {
	const worktree = createDirectory(t, 'ensemblr-ctx-');
	const victim = createDirectory(t, 'ensemblr-victim-');
	symlinkSync(victim, path.join(worktree, '.context'));

	assert.equal(ensureContextPath(worktree, 'setup.local.json'), null);
	assert.equal(readdirSync(victim).length, 0);
});

test('writeSetupStateFile writes nothing through a symlinked .context', (t) => {
	const worktree = createDirectory(t, 'ensemblr-ctx-');
	const victim = createDirectory(t, 'ensemblr-victim-');
	symlinkSync(victim, path.join(worktree, '.context'));

	writeSetupStateFile(worktree, SETUP_STATE);

	assert.equal(readdirSync(victim).length, 0);
});

test('writeSetupStateFile replaces a symlinked marker rather than following it', (t) => {
	const worktree = createDirectory(t, 'ensemblr-ctx-');
	const victim = path.join(
		createDirectory(t, 'ensemblr-victim-'),
		'authorized',
	);
	writeFileSync(victim, 'untouched');
	const marker = ensureContextPath(worktree, 'setup.local.json');
	assert.ok(marker !== null);
	symlinkSync(victim, marker);

	writeSetupStateFile(worktree, SETUP_STATE);

	assert.equal(readFileSync(victim, 'utf8'), 'untouched');
	assert.deepEqual(readSetupStateFile(worktree), SETUP_STATE);
});

test('writeTerminalOutput writes nothing through a symlinked .context', (t) => {
	const worktree = createDirectory(t, 'ensemblr-ctx-');
	const victim = createDirectory(t, 'ensemblr-victim-');
	symlinkSync(victim, path.join(worktree, '.context'));

	writeTerminalOutput(worktree, 'term-1', 'scrollback');

	assert.equal(readdirSync(victim).length, 0);
});

test('deleteTerminalOutput refuses a traversal id instead of unlinking outside', (t) => {
	const worktree = createDirectory(t, 'ensemblr-ctx-');
	const victim = path.join(createDirectory(t, 'ensemblr-victim-'), 'keep.log');
	writeFileSync(victim, 'keep');
	const traversalId = path.relative(
		path.join(worktree, '.context', 'terminals'),
		victim.slice(0, -'.log'.length),
	);

	deleteTerminalOutput(worktree, traversalId);

	assert.ok(existsSync(victim));
});

test('readTerminalOutput refuses a traversal id', (t) => {
	const worktree = createDirectory(t, 'ensemblr-ctx-');

	assert.equal(readTerminalOutput(worktree, '../../../etc/passwd'), null);
});
