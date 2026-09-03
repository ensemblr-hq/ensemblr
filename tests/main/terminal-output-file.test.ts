/// <reference types="node" />

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	deleteTerminalOutput,
	readTerminalOutput,
	writeArchivedTerminalOutput,
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

// `mkdir -p` on the log path would otherwise recreate the worktree root itself,
// putting a directory archiving already pruned back on disk.
test('writeTerminalOutput does not recreate a worktree that is gone', (t) => {
	const worktreePath = createWorktree(t);
	rmSync(worktreePath, { force: true, recursive: true });

	writeTerminalOutput(worktreePath, 'term-1', OUTPUT);

	assert.equal(existsSync(worktreePath), false);
});

test('writeTerminalOutput still creates .context inside a live worktree', (t) => {
	const worktreePath = createWorktree(t);

	writeTerminalOutput(worktreePath, 'term-1', OUTPUT);

	assert.equal(readTerminalOutput(worktreePath, 'term-1'), OUTPUT);
});

test('writeArchivedTerminalOutput writes under the archived context', (t) => {
	const contextDirectory = path.join(createWorktree(t), '.context');

	assert.equal(
		writeArchivedTerminalOutput(contextDirectory, {
			id: 'term-1',
			text: OUTPUT,
			title: 'Dev',
		}),
		null,
	);
	assert.equal(
		readFileSync(
			path.join(contextDirectory, 'terminals', 'term-1.log'),
			'utf8',
		),
		OUTPUT,
	);
});

test('writeArchivedTerminalOutput refuses an id that would escape the archive', (t) => {
	const contextDirectory = path.join(createWorktree(t), '.context');

	const failure = writeArchivedTerminalOutput(contextDirectory, {
		id: '../escape',
		text: OUTPUT,
		title: 'Escapee',
	});

	assert.match(String(failure), /not a usable terminal session id/);
	assert.equal(
		existsSync(path.join(path.dirname(contextDirectory), 'escape.log')),
		false,
	);
});
