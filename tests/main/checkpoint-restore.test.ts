import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
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
	captureWorkspaceCheckpoint,
	restoreWorkspaceTo,
} from '../../src/main/checkpoints/git-checkpoint.ts';
import {
	type EnsemblrDatabaseConnection,
	openEnsemblrDatabase,
} from '../../src/main/storage/database.ts';
import { appendAgentEvent } from '../../src/main/storage/repositories/agent-event-repository.ts';
import {
	type AgentTurnRow,
	createAgentSession,
	createTurn,
	getAgentSessionBranchById,
} from '../../src/main/storage/repositories/agent-session-repository.ts';

interface Fixture {
	agentSessionId: string;
	branchId: string;
	connection: EnsemblrDatabaseConnection;
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

	const { mainBranch, session } = createAgentSession({
		database: connection.database,
		input: { cwd: repoDirectory, workspaceId: 'ws-restore' },
	});

	return {
		branchId: mainBranch.id,
		connection,
		agentSessionId: session.id,
		repoDirectory,
		workspaceId: 'ws-restore',
	};
}

function newTurn(fixture: Fixture, prompt: string): AgentTurnRow {
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
	turn: AgentTurnRow,
	label: string,
) {
	const capture = createCheckpointCapture();
	const row = await capture({
		cwd: fixture.repoDirectory,
		database: fixture.connection.database,
		label,
		agentSessionId: fixture.agentSessionId,
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
	appendAgentEvent({
		database,
		input: {
			branchId: fixture.branchId,
			eventType: 'message',
			payload: {
				kind: 'message',
				payload: { kind: 'text', text: 'first' },
				role: 'agent',
			},
			turnId: turn.id,
		},
	});
	appendAgentEvent({
		database,
		input: {
			branchId: fixture.branchId,
			eventType: 'message',
			payload: {
				kind: 'message',
				payload: { kind: 'text', text: 'second' },
				role: 'agent',
			},
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

	const branch = getAgentSessionBranchById({ database, id: fixture.branchId });
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

test('contaminated restore updates only its worktree, leaving sibling files, index, and HEAD intact', async (t) => {
	const { repoDirectory } = openFixture(t);
	const workspace = path.join(path.dirname(repoDirectory), 'workspace');
	git(repoDirectory, 'worktree', 'add', '-b', 'workspace', workspace);
	writeFileSync(path.join(workspace, 'app.txt'), 'workspace snapshot\n');
	writeFileSync(path.join(workspace, 'note.txt'), 'captured note\n');
	const { commitHash } = await captureWorkspaceCheckpoint({
		cwd: workspace,
		message: 'restore target',
		ref: 'refs/ensemblr/checkpoints/isolation/restore',
	});
	writeFileSync(path.join(workspace, 'app.txt'), 'wrecked\n');
	writeFileSync(path.join(workspace, 'note.txt'), 'wrecked\n');
	writeFileSync(path.join(workspace, 'keep.txt'), 'untracked user work\n');
	writeFileSync(path.join(repoDirectory, 'app.txt'), 'sibling staged\n');
	git(repoDirectory, 'add', 'app.txt');
	writeFileSync(path.join(repoDirectory, 'app.txt'), 'sibling unstaged\n');
	writeFileSync(path.join(repoDirectory, 'note.txt'), 'sibling note\n');
	const siblingIndex = path.join(repoDirectory, '.git', 'index');
	const indexBefore = readFileSync(siblingIndex);
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
	try {
		Object.assign(process.env, routing);
		await restoreWorkspaceTo({ cwd: workspace, commitHash });
	} finally {
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}

	assert.equal(
		readFileSync(path.join(workspace, 'app.txt'), 'utf8'),
		'workspace snapshot\n',
	);
	assert.equal(
		readFileSync(path.join(workspace, 'note.txt'), 'utf8'),
		'captured note\n',
	);
	assert.equal(
		readFileSync(path.join(workspace, 'keep.txt'), 'utf8'),
		'untracked user work\n',
	);
	assert.equal(git(workspace, 'show', ':app.txt'), 'workspace snapshot');
	assert.equal(git(workspace, 'show', ':note.txt'), 'captured note');
	assert.deepEqual(readFileSync(siblingIndex), indexBefore);
	assert.equal(git(repoDirectory, 'rev-parse', 'HEAD'), headBefore);
	assert.equal(git(workspace, 'rev-parse', 'HEAD'), headBefore);
	assert.equal(
		readFileSync(path.join(repoDirectory, 'app.txt'), 'utf8'),
		'sibling unstaged\n',
	);
	assert.equal(
		readFileSync(path.join(repoDirectory, 'note.txt'), 'utf8'),
		'sibling note\n',
	);
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
