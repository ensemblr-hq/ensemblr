import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	checkpointRefFor,
	createCheckpointCapture,
} from '../../src/main/checkpoints/checkpoint-service.ts';
import { captureWorkspaceCheckpoint } from '../../src/main/checkpoints/git-checkpoint.ts';
import {
	type EnsemblrDatabaseConnection,
	openEnsemblrDatabase,
} from '../../src/main/storage/database.ts';
import {
	createAgentSession,
	createTurn,
} from '../../src/main/storage/repositories/agent-session-repository.ts';
import { getCheckpointByTurnId } from '../../src/main/storage/repositories/checkpoint-repository.ts';

interface Fixture {
	agentSessionId: string;
	connection: EnsemblrDatabaseConnection;
	repoDirectory: string;
	turnId: string;
	workspaceId: string;
}

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function initGitRepo(directory: string): void {
	git(directory, 'init', '--initial-branch=main');
	git(directory, 'config', 'user.email', 'test@ensemblr.local');
	git(directory, 'config', 'user.name', 'Ensemblr Test');
	writeFileSync(path.join(directory, 'tracked.txt'), 'initial\n');
	git(directory, 'add', '-A');
	git(directory, 'commit', '-m', 'initial');
}

function openFixture(t: import('node:test').TestContext): Fixture {
	const root = mkdtempSync(path.join(tmpdir(), 'ensemblr-checkpoint-test-'));
	const repoDirectory = path.join(root, 'repo');
	const databasePath = path.join(root, 'test.db');
	execFileSync('mkdir', ['-p', repoDirectory]);
	initGitRepo(repoDirectory);

	const connection = openEnsemblrDatabase({ databasePath });
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

	const { mainBranch, session } = createAgentSession({
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
		agentSessionId: session.id,
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
		agentSessionId: fixture.agentSessionId,
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
	assert.equal(row.agentSessionId, fixture.agentSessionId);

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
		message: 'ensemblr checkpoint: test',
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

test('contaminated capture snapshots its worktree without touching sibling files, index, or HEAD', async (t) => {
	const { repoDirectory } = openFixture(t);
	const workspace = path.join(path.dirname(repoDirectory), 'workspace');
	git(repoDirectory, 'worktree', 'add', '-b', 'workspace', workspace);
	writeFileSync(path.join(repoDirectory, 'tracked.txt'), 'sibling staged\n');
	git(repoDirectory, 'add', 'tracked.txt');
	writeFileSync(path.join(repoDirectory, 'tracked.txt'), 'sibling unstaged\n');
	writeFileSync(path.join(workspace, 'tracked.txt'), 'workspace staged\n');
	git(workspace, 'add', 'tracked.txt');
	writeFileSync(path.join(workspace, 'tracked.txt'), 'workspace snapshot\n');
	writeFileSync(path.join(workspace, 'untracked.txt'), 'workspace only\n');
	const siblingIndex = path.join(repoDirectory, '.git', 'index');
	const workspaceIndex = git(workspace, 'rev-parse', '--git-path', 'index');
	const siblingIndexBefore = readFileSync(siblingIndex);
	const workspaceIndexBefore = readFileSync(workspaceIndex);
	const headBefore = git(workspace, 'rev-parse', 'HEAD');
	const routing = {
		GIT_DIR: path.join(repoDirectory, '.git'),
		GIT_WORK_TREE: repoDirectory,
		GIT_INDEX_FILE: siblingIndex,
		GIT_CONFIG_COUNT: '1',
		GIT_CONFIG_KEY_0: 'core.worktree',
		GIT_CONFIG_VALUE_0: repoDirectory,
	};
	const previous = Object.keys(routing).map(
		(key) => [key, process.env[key]] as const,
	);
	const ref = 'refs/ensemblr/checkpoints/isolation/capture';
	try {
		Object.assign(process.env, routing);
		await captureWorkspaceCheckpoint({
			cwd: workspace,
			message: 'isolated capture',
			ref,
		});
	} finally {
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}

	assert.equal(
		git(workspace, 'show', `${ref}:tracked.txt`),
		'workspace snapshot',
	);
	assert.equal(
		git(workspace, 'show', `${ref}:untracked.txt`),
		'workspace only',
	);
	assert.equal(git(workspace, 'rev-parse', `${ref}^`), headBefore);
	assert.deepEqual(readFileSync(siblingIndex), siblingIndexBefore);
	assert.deepEqual(readFileSync(workspaceIndex), workspaceIndexBefore);
	assert.equal(git(repoDirectory, 'rev-parse', 'HEAD'), headBefore);
	assert.equal(git(workspace, 'rev-parse', 'HEAD'), headBefore);
	assert.equal(
		readFileSync(path.join(repoDirectory, 'tracked.txt'), 'utf8'),
		'sibling unstaged\n',
	);
	assert.equal(
		readFileSync(path.join(workspace, 'tracked.txt'), 'utf8'),
		'workspace snapshot\n',
	);
});

test('capture on a clean workspace records the HEAD tree state', async (t) => {
	const fixture = openFixture(t);

	const result = await captureWorkspaceCheckpoint({
		cwd: fixture.repoDirectory,
		message: 'ensemblr checkpoint: clean',
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

test('refuses refs outside the ensemblr checkpoint namespace', async () => {
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
		path.join(tmpdir(), 'ensemblr-checkpoint-nongit-'),
	);
	t.after(() => rmSync(nonGitDirectory, { force: true, recursive: true }));

	const capture = createCheckpointCapture();
	const row = await capture({
		cwd: nonGitDirectory,
		database: fixture.connection.database,
		label: 'no repo here',
		agentSessionId: fixture.agentSessionId,
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
