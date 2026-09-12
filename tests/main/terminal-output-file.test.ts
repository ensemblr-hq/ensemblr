/// <reference types="node" />

import assert from 'node:assert/strict';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { sanitizeCreateTerminalSessionRequest } from '../../src/main/ipc/request-schemas/terminal.ts';
import {
	appendTerminalOutput,
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

test('appendTerminalOutput extends an existing log', async (t) => {
	const worktreePath = createWorktree(t);

	writeTerminalOutput(worktreePath, 'term-1', OUTPUT);
	assert.equal(
		await appendTerminalOutput(worktreePath, 'term-1', 'tail\r\n'),
		true,
	);

	assert.equal(readTerminalOutput(worktreePath, 'term-1'), `${OUTPUT}tail\r\n`);
});

test('appendTerminalOutput refuses when no log exists yet', async (t) => {
	const worktreePath = createWorktree(t);

	assert.equal(
		await appendTerminalOutput(worktreePath, 'term-1', 'tail'),
		false,
	);
	assert.equal(readTerminalOutput(worktreePath, 'term-1'), null);
});

test('appendTerminalOutput refuses a session id that is not a single filename', async (t) => {
	const worktreePath = createWorktree(t);

	assert.equal(
		await appendTerminalOutput(worktreePath, '../escape', 'tail'),
		false,
	);
});

test('appendTerminalOutput refuses to write through a symlinked log', async (t) => {
	const worktreePath = createWorktree(t);
	const outsidePath = path.join(worktreePath, 'outside.log');
	writeFileSync(outsidePath, 'untouched');

	writeTerminalOutput(worktreePath, 'term-1', OUTPUT);
	const logPath = path.join(
		worktreePath,
		'.context',
		'terminals',
		'term-1.log',
	);
	rmSync(logPath);
	symlinkSync(outsidePath, logPath);

	assert.equal(
		await appendTerminalOutput(worktreePath, 'term-1', 'tail'),
		false,
	);
	assert.equal(readFileSync(outsidePath, 'utf8'), 'untouched');
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

test('scrollback logs and their directory are owner-only', (t) => {
	if (process.platform === 'win32') {
		t.skip('POSIX modes are not meaningful on Windows.');
		return;
	}

	const worktreePath = createWorktree(t);
	writeTerminalOutput(worktreePath, 'term-1', OUTPUT);

	assert.equal(
		statSync(path.join(worktreePath, '.context', 'terminals', 'term-1.log'))
			.mode & 0o777,
		0o600,
	);

	const contextDirectory = path.join(createWorktree(t), '.context');
	assert.equal(
		writeArchivedTerminalOutput(contextDirectory, {
			id: 'term-2',
			text: OUTPUT,
			title: 'Dev',
		}),
		null,
	);

	const archivedDirectory = path.join(contextDirectory, 'terminals');
	assert.equal(statSync(archivedDirectory).mode & 0o777, 0o700);
	assert.equal(
		statSync(path.join(archivedDirectory, 'term-2.log')).mode & 0o777,
		0o600,
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

test('writeTerminalOutput ignores a session id that is not a single filename', (t) => {
	const worktreePath = createWorktree(t);

	writeTerminalOutput(worktreePath, '../escaped', OUTPUT);

	assert.equal(
		existsSync(path.join(path.dirname(worktreePath), 'escaped.log')),
		false,
	);
});

test('sanitizeCreateTerminalSessionRequest drops a traversal restoredFromId', () => {
	const sanitized = sanitizeCreateTerminalSessionRequest({
		restoredFromId: '../../../etc/passwd',
		workspaceId: 'ws-1',
	});

	assert.equal(sanitized.restoredFromId, undefined);
	assert.equal(sanitized.workspaceId, 'ws-1');
});

test('sanitizeCreateTerminalSessionRequest keeps a plain session id', () => {
	const sanitized = sanitizeCreateTerminalSessionRequest({
		restoredFromId: 'c6f6b0e2-0e5f-4f0a-9f3b-8c0a1f4f2a11',
		workspaceId: 'ws-1',
	});

	assert.equal(
		sanitized.restoredFromId,
		'c6f6b0e2-0e5f-4f0a-9f3b-8c0a1f4f2a11',
	);
});
