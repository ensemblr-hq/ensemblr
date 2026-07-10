import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	computeTurnDiff,
	createCheckpointCapture,
	isOrdinalHidden,
	readHiddenEventRanges,
	restoreTurnCheckpoint,
} from '../../src/main/checkpoints/checkpoint-service.ts';
import {
	type EnsemblrDatabaseConnection,
	openEnsemblrDatabase,
} from '../../src/main/storage/database.ts';
import { appendPiEvent } from '../../src/main/storage/repositories/pi-event-repository.ts';
import {
	createPiSession,
	createTurn,
	getPiSessionBranchById,
	type PiTurnRow,
} from '../../src/main/storage/repositories/pi-session-repository.ts';

interface Fixture {
	branchId: string;
	connection: EnsemblrDatabaseConnection;
	piSessionId: string;
	repoDirectory: string;
	workspaceId: string;
}

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function openFixture(t: import('node:test').TestContext): Fixture {
	const root = mkdtempSync(path.join(tmpdir(), 'ensemblr-restore-test-'));
	const repoDirectory = path.join(root, 'repo');
	execFileSync('mkdir', ['-p', repoDirectory]);
	git(repoDirectory, 'init', '--initial-branch=main');
	git(repoDirectory, 'config', 'user.email', 'test@ensemblr.local');
	git(repoDirectory, 'config', 'user.name', 'Ensemblr Test');
	writeFileSync(path.join(repoDirectory, 'app.txt'), 'v1\n');
	git(repoDirectory, 'add', '-A');
	git(repoDirectory, 'commit', '-m', 'initial');

	const connection = openEnsemblrDatabase({
		databasePath: path.join(root, 'test.db'),
	});
	t.after(() => {
		connection.database.close();
		rmSync(root, { force: true, recursive: true });
	});

	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-restore', 'restore', 'Restore', '${repoDirectory}', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('ws-restore', 'repo-restore', 'restore', 'Restore', '${repoDirectory}');
`);

	const { mainBranch, session } = createPiSession({
		database: connection.database,
		input: { cwd: repoDirectory, workspaceId: 'ws-restore' },
	});

	return {
		branchId: mainBranch.id,
		connection,
		piSessionId: session.id,
		repoDirectory,
		workspaceId: 'ws-restore',
	};
}

function newTurn(fixture: Fixture, prompt: string): PiTurnRow {
	return createTurn({
		database: fixture.connection.database,
		input: {
			branchId: fixture.branchId,
			model: null,
			promptText: prompt,
			thinkingLevel: null,
		},
	});
}

async function captureForTurn(
	fixture: Fixture,
	turn: PiTurnRow,
	label: string,
) {
	const capture = createCheckpointCapture();
	const row = await capture({
		cwd: fixture.repoDirectory,
		database: fixture.connection.database,
		label,
		piSessionId: fixture.piSessionId,
		turnId: turn.id,
		workspaceId: fixture.workspaceId,
	});
	assert.ok(row, `checkpoint capture failed for ${label}`);
	return row;
}

test('computeTurnDiff diffs a checkpoint against the next checkpoint', async (t) => {
	const fixture = openFixture(t);

	const turn1 = newTurn(fixture, 'first change');
	await captureForTurn(fixture, turn1, 'first change');

	// Simulate the agent's edits during turn 1.
	writeFileSync(path.join(fixture.repoDirectory, 'app.txt'), 'v2\n');
	writeFileSync(path.join(fixture.repoDirectory, 'new.txt'), 'created\n');

	const turn2 = newTurn(fixture, 'second change');
	await captureForTurn(fixture, turn2, 'second change');

	const diff = await computeTurnDiff({
		cwd: fixture.repoDirectory,
		database: fixture.connection.database,
		turnId: turn1.id,
	});

	const paths = diff.files.map((file) => file.path).sort();
	assert.deepEqual(paths, ['app.txt', 'new.txt']);
	assert.ok(diff.patch.includes('+v2'));
	assert.equal(
		diff.files.find((file) => file.path === 'new.txt')?.status,
		'added',
	);
});

test('computeTurnDiff falls back to the live working tree for the latest turn', async (t) => {
	const fixture = openFixture(t);

	const turn = newTurn(fixture, 'live change');
	await captureForTurn(fixture, turn, 'live change');

	writeFileSync(path.join(fixture.repoDirectory, 'app.txt'), 'live\n');

	const diff = await computeTurnDiff({
		cwd: fixture.repoDirectory,
		database: fixture.connection.database,
		turnId: turn.id,
	});
	assert.deepEqual(
		diff.files.map((file) => file.path),
		['app.txt'],
	);
});

test('restoreTurnCheckpoint reverts tracked files and records truncation', async (t) => {
	const fixture = openFixture(t);

	// Pre-prompt state: app.txt=v1 plus an untracked-but-captured note.
	writeFileSync(path.join(fixture.repoDirectory, 'note.txt'), 'keep me\n');
	const turn = newTurn(fixture, 'risky change');
	await captureForTurn(fixture, turn, 'risky change');

	// Events for the turn (and a later one) that should be hidden after restore.
	const database = fixture.connection.database;
	appendPiEvent({
		database,
		input: {
			branchId: fixture.branchId,
			eventType: 'message',
			payload: { kind: 'message' },
			turnId: turn.id,
		},
	});
	appendPiEvent({
		database,
		input: {
			branchId: fixture.branchId,
			eventType: 'message',
			payload: { kind: 'message' },
			turnId: turn.id,
		},
	});

	// Simulate the agent wrecking the workspace during the turn.
	writeFileSync(path.join(fixture.repoDirectory, 'app.txt'), 'wrecked\n');
	writeFileSync(path.join(fixture.repoDirectory, 'note.txt'), 'wrecked\n');

	const result = await restoreTurnCheckpoint({
		cwd: fixture.repoDirectory,
		database,
		turnId: turn.id,
	});
	assert.equal(result.checkpoint.turnId, turn.id);

	assert.equal(
		git(fixture.repoDirectory, 'show', ':app.txt') ||
			execFileSync('cat', [path.join(fixture.repoDirectory, 'app.txt')], {
				encoding: 'utf8',
			}).trim(),
		'v1',
	);
	assert.equal(
		execFileSync('cat', [path.join(fixture.repoDirectory, 'note.txt')], {
			encoding: 'utf8',
		}).trim(),
		'keep me',
	);

	const branch = getPiSessionBranchById({ database, id: fixture.branchId });
	assert.ok(branch);
	const ranges = readHiddenEventRanges(branch.metadata);
	assert.equal(ranges.length, 1);
	// Both turn events (ordinals 0 and 1) fall inside the hidden range.
	assert.equal(isOrdinalHidden(0, ranges), true);
	assert.equal(isOrdinalHidden(1, ranges), true);
	// A post-restore event with a higher ordinal stays visible.
	assert.equal(isOrdinalHidden(2, ranges), false);
});

test('restore leaves never-tracked post-checkpoint files in place', async (t) => {
	const fixture = openFixture(t);

	const turn = newTurn(fixture, 'safe restore');
	await captureForTurn(fixture, turn, 'safe restore');

	const strayPath = path.join(fixture.repoDirectory, 'user-notes.md');
	writeFileSync(strayPath, 'unrelated user work\n');

	await restoreTurnCheckpoint({
		cwd: fixture.repoDirectory,
		database: fixture.connection.database,
		turnId: turn.id,
	});

	assert.equal(existsSync(strayPath), true);
});

test('restoreTurnCheckpoint fails cleanly when no checkpoint exists', async (t) => {
	const fixture = openFixture(t);
	const turn = newTurn(fixture, 'no checkpoint');

	await assert.rejects(
		restoreTurnCheckpoint({
			cwd: fixture.repoDirectory,
			database: fixture.connection.database,
			turnId: turn.id,
		}),
		/No checkpoint was captured/,
	);
});
