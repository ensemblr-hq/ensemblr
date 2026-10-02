/// <reference types="node" />

import assert from 'node:assert/strict';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	readSetupStateFile,
	SETUP_STATE_FILENAME,
	writeSetupStateFile,
} from '../../src/main/scripts/setup-state-file.ts';
import type { WorkspaceSetupState } from '../../src/shared/scripts/setup-state.ts';

const STATE: WorkspaceSetupState = {
	command: 'npm install',
	completedAt: '2026-07-11T00:00:00.000Z',
	fingerprint: 'abc123',
};

function createWorktree(t: TestContext): string {
	const worktreePath = mkdtempSync(path.join(tmpdir(), 'ensemblr-setup-'));
	t.after(() => rmSync(worktreePath, { force: true, recursive: true }));

	return worktreePath;
}

test('readSetupStateFile returns null when the marker is absent', (t) => {
	assert.equal(readSetupStateFile(createWorktree(t)), null);
});

test('writeSetupStateFile then readSetupStateFile round-trips the state', (t) => {
	const worktreePath = createWorktree(t);

	writeSetupStateFile(worktreePath, STATE);

	assert.deepEqual(readSetupStateFile(worktreePath), STATE);
});

test('writeSetupStateFile writes the marker under .context', (t) => {
	const worktreePath = createWorktree(t);

	writeSetupStateFile(worktreePath, STATE);

	const markerPath = path.join(worktreePath, '.context', SETUP_STATE_FILENAME);
	assert.deepEqual(JSON.parse(readFileSync(markerPath, 'utf8')), STATE);
});

test('readSetupStateFile falls back to the legacy .ensemblr marker', (t) => {
	const worktreePath = createWorktree(t);
	const legacyDir = path.join(worktreePath, '.ensemblr');
	mkdirSync(legacyDir, { recursive: true });
	writeFileSync(
		path.join(legacyDir, SETUP_STATE_FILENAME),
		JSON.stringify(STATE),
	);

	assert.deepEqual(readSetupStateFile(worktreePath), STATE);
});

test('the .context marker takes precedence over a legacy .ensemblr marker', (t) => {
	const worktreePath = createWorktree(t);
	const legacyDir = path.join(worktreePath, '.ensemblr');
	mkdirSync(legacyDir, { recursive: true });
	writeFileSync(
		path.join(legacyDir, SETUP_STATE_FILENAME),
		JSON.stringify({ ...STATE, fingerprint: 'legacy' }),
	);

	writeSetupStateFile(worktreePath, STATE);

	assert.deepEqual(readSetupStateFile(worktreePath), STATE);
});

test('readSetupStateFile returns null for a malformed marker', (t) => {
	const worktreePath = createWorktree(t);

	writeSetupStateFile(worktreePath, STATE);
	writeFileSync(
		path.join(worktreePath, '.context', SETUP_STATE_FILENAME),
		'{ not json',
	);

	assert.equal(readSetupStateFile(worktreePath), null);
});
