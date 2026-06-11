import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	checkpointRefFor,
	createCheckpointCapture,
} from '../../src/main/checkpoints/checkpoint-service.ts';
import { captureWorkspaceCheckpoint } from '../../src/main/checkpoints/git-checkpoint.ts';
import {
	type EnsembleDatabaseConnection,
	openEnsembleDatabase,
} from '../../src/main/storage/database.ts';
import { getCheckpointByTurnId } from '../../src/main/storage/repositories/checkpoint-repository.ts';
import {
	createPiSession,
	createTurn,
} from '../../src/main/storage/repositories/pi-session-repository.ts';

interface Fixture {
	connection: EnsembleDatabaseConnection;
	piSessionId: string;
	repoDirectory: string;
	turnId: string;
	workspaceId: string;
}

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function initGitRepo(directory: string): void {
	git(directory, 'init', '--initial-branch=main');
	git(directory, 'config', 'user.email', 'test@ensemble.local');
	git(directory, 'config', 'user.name', 'Ensemble Test');
	writeFileSync(path.join(directory, 'tracked.txt'), 'initial\n');
	git(directory, 'add', '-A');
	git(directory, 'commit', '-m', 'initial');
}

function openFixture(t: import('node:test').TestContext): Fixture {
	const root = mkdtempSync(path.join(tmpdir(), 'ensemble-checkpoint-test-'));
	const repoDirectory = path.join(root, 'repo');
	const databasePath = path.join(root, 'test.db');
	execFileSync('mkdir', ['-p', repoDirectory]);
	initGitRepo(repoDirectory);

	const connection = openEnsembleDatabase({ databasePath });
	t.after(() => {
		connection.database.close();
		rmSync(root, { force: true, recursive: true });
	});

	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-ckpt', 'ckpt', 'Ckpt', '${repoDirectory}', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('ws-ckpt', 'repo-ckpt', 'ckpt', 'Ckpt', '${repoDirectory}');
`);

	const { mainBranch, session } = createPiSession({
		database: connection.database,
		input: { cwd: repoDirectory, workspaceId: 'ws-ckpt' },
	});
	const turn = createTurn({
		database: connection.database,
		input: {
			branchId: mainBranch.id,
			model: null,
			promptText: 'change something',
			thinkingLevel: null,
		},
	});

	return {
		connection,
		piSessionId: session.id,
		repoDirectory,
		turnId: turn.id,
		workspaceId: 'ws-ckpt',
	};
}

test('captures dirty and untracked files into a private ref', async (t) => {
	const fixture = openFixture(t);

	writeFileSync(path.join(fixture.repoDirectory, 'tracked.txt'), 'modified\n');
	writeFileSync(path.join(fixture.repoDirectory, 'untracked.txt'), 'new\n');

	const capture = createCheckpointCapture();
	const row = await capture({
		cwd: fixture.repoDirectory,
		database: fixture.connection.database,
		label: 'change something',
		piSessionId: fixture.piSessionId,
		turnId: fixture.turnId,
		workspaceId: fixture.workspaceId,
	});

	assert.ok(row);
	const expectedRef = checkpointRefFor({
		turnId: fixture.turnId,
		workspaceId: fixture.workspaceId,
	});
	assert.equal(row.gitRef, expectedRef);
	assert.equal(row.turnId, fixture.turnId);
	assert.equal(row.piSessionId, fixture.piSessionId);

	const refHash = git(fixture.repoDirectory, 'rev-parse', expectedRef);
	assert.equal(refHash, row.gitHash);
	assert.equal(
		git(fixture.repoDirectory, 'show', `${expectedRef}:tracked.txt`),
		'modified',
	);
	assert.equal(
		git(fixture.repoDirectory, 'show', `${expectedRef}:untracked.txt`),
		'new',
	);

	const persisted = getCheckpointByTurnId({
		database: fixture.connection.database,
		turnId: fixture.turnId,
	});
	assert.equal(persisted?.id, row.id);
});

test('capture leaves branches, HEAD, and the real index untouched', async (t) => {
	const fixture = openFixture(t);
	const headBefore = git(fixture.repoDirectory, 'rev-parse', 'HEAD');

	writeFileSync(path.join(fixture.repoDirectory, 'untracked.txt'), 'new\n');
	const statusBefore = git(fixture.repoDirectory, 'status', '--porcelain');

	await captureWorkspaceCheckpoint({
		cwd: fixture.repoDirectory,
		message: 'ensemble checkpoint: test',
		ref: checkpointRefFor({
			turnId: fixture.turnId,
			workspaceId: fixture.workspaceId,
		}),
	});

	assert.equal(git(fixture.repoDirectory, 'rev-parse', 'HEAD'), headBefore);
	assert.equal(
		git(fixture.repoDirectory, 'status', '--porcelain'),
		statusBefore,
	);
});

test('capture on a clean workspace records the HEAD tree state', async (t) => {
	const fixture = openFixture(t);

	const result = await captureWorkspaceCheckpoint({
		cwd: fixture.repoDirectory,
		message: 'ensemble checkpoint: clean',
		ref: checkpointRefFor({
			turnId: fixture.turnId,
			workspaceId: fixture.workspaceId,
		}),
	});

	const headTree = git(fixture.repoDirectory, 'rev-parse', 'HEAD^{tree}');
	assert.equal(result.treeHash, headTree);
	assert.equal(
		git(fixture.repoDirectory, 'rev-parse', `${result.commitHash}^`),
		git(fixture.repoDirectory, 'rev-parse', 'HEAD'),
	);
});

test('refuses refs outside the ensemble checkpoint namespace', async () => {
	await assert.rejects(
		captureWorkspaceCheckpoint({
			cwd: tmpdir(),
			message: 'nope',
			ref: 'refs/heads/main',
		}),
		/Refusing to write outside/,
	);
});

test('capture failure warns and returns null without blocking', async (t) => {
	const fixture = openFixture(t);
	const nonGitDirectory = mkdtempSync(
		path.join(tmpdir(), 'ensemble-checkpoint-nongit-'),
	);
	t.after(() => rmSync(nonGitDirectory, { force: true, recursive: true }));

	const capture = createCheckpointCapture();
	const row = await capture({
		cwd: nonGitDirectory,
		database: fixture.connection.database,
		label: 'no repo here',
		piSessionId: fixture.piSessionId,
		turnId: fixture.turnId,
		workspaceId: fixture.workspaceId,
	});

	assert.equal(row, null);
	assert.equal(
		getCheckpointByTurnId({
			database: fixture.connection.database,
			turnId: fixture.turnId,
		}),
		null,
	);
});
