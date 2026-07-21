/// <reference types="node" />

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	deleteTerminalOutput,
	readTerminalOutput,
	writeTerminalOutput,
} from '../../src/main/terminal/terminal-output-file.ts';

function createWorktree(t: TestContext): string {
	const worktreePath = mkdtempSync(path.join(tmpdir(), 'ensemblr-term-out-'));
	t.after(() => rmSync(worktreePath, { force: true, recursive: true }));

	return worktreePath;
}

const OUTPUT = 'line one\r\n[32mgreen[0m line two\r\n';

test('readTerminalOutput returns null when no log exists', (t) => {
	assert.equal(readTerminalOutput(createWorktree(t), 'term-1'), null);
});

test('writeTerminalOutput then readTerminalOutput round-trips raw bytes', (t) => {
	const worktreePath = createWorktree(t);

	writeTerminalOutput(worktreePath, 'term-1', OUTPUT);

	assert.equal(readTerminalOutput(worktreePath, 'term-1'), OUTPUT);
});

test('writeTerminalOutput writes under .context/terminals', (t) => {
	const worktreePath = createWorktree(t);

	writeTerminalOutput(worktreePath, 'term-1', OUTPUT);

	assert.ok(
		existsSync(path.join(worktreePath, '.context', 'terminals', 'term-1.log')),
	);
});

test('a later write replaces the prior output for the same session', (t) => {
	const worktreePath = createWorktree(t);

	writeTerminalOutput(worktreePath, 'term-1', 'first');
	writeTerminalOutput(worktreePath, 'term-1', 'second');

	assert.equal(readTerminalOutput(worktreePath, 'term-1'), 'second');
});

test('deleteTerminalOutput removes the log and is a no-op when absent', (t) => {
	const worktreePath = createWorktree(t);

	writeTerminalOutput(worktreePath, 'term-1', OUTPUT);
	deleteTerminalOutput(worktreePath, 'term-1');
	assert.equal(readTerminalOutput(worktreePath, 'term-1'), null);

	deleteTerminalOutput(worktreePath, 'term-1');
});
