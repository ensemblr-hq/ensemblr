import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
	captureWorkspaceCheckpoint,
	diffTrees,
	restoreWorkspaceTo,
} from '../../src/main/checkpoints/git-checkpoint.ts';
import {
	checkpointRefFor,
	createTurnCheckpoints,
} from '../../src/main/checkpoints/turn-checkpoints.ts';
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

	const capture = createTurnCheckpoints().openTurn;
	const row = await capture({
		closingTurnId: null,
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

function captureFixtureCheckpoint(fixture: Fixture) {
	return captureWorkspaceCheckpoint({
		cwd: fixture.repoDirectory,
		message: 'ensemblr checkpoint: test',
		ref: checkpointRefFor({
			turnId: fixture.turnId,
			workspaceId: fixture.workspaceId,
		}),
	});
}

test('capture keeps a tracked file that later gained an ignore rule, and restore does not delete it', async (t) => {
	const fixture = openFixture(t);
	const configPath = path.join(fixture.repoDirectory, 'cfg.txt');
	writeFileSync(configPath, 'committed\n');
	git(fixture.repoDirectory, 'add', 'cfg.txt');
	git(fixture.repoDirectory, 'commit', '-m', 'track cfg');
	writeFileSync(path.join(fixture.repoDirectory, '.gitignore'), 'cfg.txt\n');
	writeFileSync(configPath, 'modified after ignore\n');

	const { commitHash, treeHash } = await captureFixtureCheckpoint(fixture);

	assert.equal(
		git(fixture.repoDirectory, 'show', `${treeHash}:cfg.txt`),
		'modified after ignore',
	);

	writeFileSync(configPath, 'edited after checkpoint\n');
	await restoreWorkspaceTo({ commitHash, cwd: fixture.repoDirectory });

	assert.equal(readFileSync(configPath, 'utf8'), 'modified after ignore\n');
});

test('capture records deletions of tracked files and skips never-tracked ignored files', async (t) => {
	const fixture = openFixture(t);
	writeFileSync(path.join(fixture.repoDirectory, 'doomed.txt'), 'doomed\n');
	git(fixture.repoDirectory, 'add', 'doomed.txt');
	git(fixture.repoDirectory, 'commit', '-m', 'track doomed');
	writeFileSync(path.join(fixture.repoDirectory, '.gitignore'), 'ignored/\n');
	mkdirSync(path.join(fixture.repoDirectory, 'ignored'));
	writeFileSync(path.join(fixture.repoDirectory, 'ignored', 'dep.js'), 'x\n');
	rmSync(path.join(fixture.repoDirectory, 'doomed.txt'));

	const { treeHash } = await captureFixtureCheckpoint(fixture);

	const files = git(
		fixture.repoDirectory,
		'ls-tree',
		'-r',
		'--name-only',
		treeHash,
	).split('\n');
	assert.deepEqual(files, ['.gitignore', 'tracked.txt']);
});

test('capture works on an unborn branch with no HEAD to seed from', async (t) => {
	const root = mkdtempSync(path.join(tmpdir(), 'ensemblr-checkpoint-unborn-'));
	t.after(() => rmSync(root, { force: true, recursive: true }));
	git(root, 'init', '--initial-branch=main');
	writeFileSync(path.join(root, 'first.txt'), 'first\n');

	const result = await captureWorkspaceCheckpoint({
		cwd: root,
		message: 'ensemblr checkpoint: unborn',
		ref: 'refs/ensemblr/checkpoints/unborn/capture',
	});

	assert.equal(result.parentHash, null);
	assert.equal(git(root, 'show', `${result.treeHash}:first.txt`), 'first');
});

test('diffTrees reports non-ASCII paths verbatim instead of C-quoted', async (t) => {
	const { repoDirectory } = openFixture(t);
	writeFileSync(path.join(repoDirectory, 'café.txt'), 'same content\n');
	git(repoDirectory, 'add', 'café.txt');
	git(repoDirectory, 'commit', '-m', 'add cafe');
	git(repoDirectory, 'mv', 'café.txt', 'crème.txt');
	git(repoDirectory, 'commit', '-m', 'rename cafe');

	const { files, patch } = await diffTrees({
		cwd: repoDirectory,
		fromRev: 'HEAD~1',
		toRev: 'HEAD',
	});

	assert.deepEqual(files, [
		{ additions: 0, deletions: 0, path: 'crème.txt', status: 'renamed' },
	]);
	assert.ok(patch.includes('rename to crème.txt'));
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

test('capture failure warns, records the loss, and returns null without blocking', async (t) => {
	const fixture = openFixture(t);
	const nonGitDirectory = mkdtempSync(
		path.join(tmpdir(), 'ensemblr-checkpoint-nongit-'),
	);
	t.after(() => rmSync(nonGitDirectory, { force: true, recursive: true }));

	const capture = createTurnCheckpoints().openTurn;
	const row = await capture({
		closingTurnId: null,
		cwd: nonGitDirectory,
		database: fixture.connection.database,
		label: 'no repo here',
		agentSessionId: fixture.agentSessionId,
		turnId: fixture.turnId,
		workspaceId: fixture.workspaceId,
	});

	assert.equal(row, null);
	// Recorded without a commit, so the turn reads as lost rather than pending.
	const recorded = getCheckpointByTurnId({
		database: fixture.connection.database,
		turnId: fixture.turnId,
	});
	assert.equal(recorded?.gitHash, null);
	assert.equal(recorded?.reason, 'capture-failed');
});

/** A chat of some workspace with one turn to open, as a boundary operation takes it. */
interface Chat {
	agentSessionId: string;
	cwd: string;
	database: DatabaseSync;
	turnId: string;
	workspaceId: string;
}

/**
 * Adds a chat with one turn to `workspaceId`, creating that workspace first when
 * it is new. The fake captures below never touch `cwd`, so every chat can share
 * the fixture's repository.
 */
function addChat(fixture: Fixture, workspaceId: string): Chat {
	const { database } = fixture.connection;
	database
		.prepare(
			`INSERT OR IGNORE INTO workspaces (id, repository_id, slug, name, path)
VALUES (?, 'repo-ckpt', ?, ?, ?)`,
		)
		.run(
			workspaceId,
			workspaceId,
			workspaceId,
			`${fixture.repoDirectory}-${workspaceId}`,
		);
	const { mainBranch, session } = createAgentSession({
		database,
		input: { cwd: fixture.repoDirectory, workspaceId },
	});
	const turn = createTurn({
		database,
		input: {
			branchId: mainBranch.id,
			model: null,
			promptText: 'ask',
			thinkingLevel: null,
		},
	});

	return {
		agentSessionId: session.id,
		cwd: fixture.repoDirectory,
		database,
		turnId: turn.id,
		workspaceId,
	};
}

/** The opening ref a chat's turn is captured under. */
const openingRef = (chat: Chat): string =>
	checkpointRefFor({ turnId: chat.turnId, workspaceId: chat.workspaceId });

/** The ref the same turn's end is captured under. */
const endingRef = (chat: Chat): string => `${openingRef(chat)}-end`;

/** Lets every promise the port has queued run to its next real wait. */
const flush = (): Promise<void> =>
	new Promise((resolve) => {
		setImmediate(resolve);
	});

/**
 * A capture that holds each snapshot in flight until the test releases its ref,
 * recording which refs started and how many were in flight at once.
 */
function createHeldCapture() {
	const started: string[] = [];
	const releases = new Map<string, () => void>();
	let inFlight = 0;
	let peak = 0;
	const capture: typeof captureWorkspaceCheckpoint = async ({ ref }) => {
		started.push(ref);
		inFlight += 1;
		peak = Math.max(peak, inFlight);
		await new Promise<void>((resolve) => {
			releases.set(ref, resolve);
		});
		inFlight -= 1;

		return {
			commitHash: `commit-${started.length}`,
			parentHash: null,
			ref,
			treeHash: 'tree',
		};
	};

	return {
		capture,
		inFlight: () => inFlight,
		peak: () => peak,
		release: (ref: string) => releases.get(ref)?.(),
		started,
	};
}

test('two chats in one workspace never capture at the same time', async (t) => {
	const fixture = openFixture(t);
	const first = addChat(fixture, fixture.workspaceId);
	const second = addChat(fixture, fixture.workspaceId);
	const held = createHeldCapture();
	const boundaries = createTurnCheckpoints({ capture: held.capture });

	const opened = [
		boundaries.openTurn({ ...first, closingTurnId: null, label: 'first' }),
		boundaries.openTurn({ ...second, closingTurnId: null, label: 'second' }),
	];
	await flush();
	assert.deepEqual(held.started, [openingRef(first)]);

	held.release(openingRef(first));
	await flush();
	assert.deepEqual(held.started, [openingRef(first), openingRef(second)]);

	held.release(openingRef(second));
	await Promise.all(opened);
	assert.equal(held.peak(), 1);
});

test('chats in different workspaces capture at the same time', async (t) => {
	const fixture = openFixture(t);
	const here = addChat(fixture, fixture.workspaceId);
	const elsewhere = addChat(fixture, 'ws-ckpt-elsewhere');
	const held = createHeldCapture();
	const boundaries = createTurnCheckpoints({ capture: held.capture });

	const opened = [
		boundaries.openTurn({ ...here, closingTurnId: null, label: 'here' }),
		boundaries.openTurn({
			...elsewhere,
			closingTurnId: null,
			label: 'elsewhere',
		}),
	];
	await flush();
	assert.equal(held.inFlight(), 2);

	held.release(openingRef(here));
	held.release(openingRef(elsewhere));
	await Promise.all(opened);
});

test('one chat keeps its boundaries in the order they were queued', async (t) => {
	const fixture = openFixture(t);
	const chat = addChat(fixture, fixture.workspaceId);
	const held = createHeldCapture();
	const boundaries = createTurnCheckpoints({ capture: held.capture });

	const opened = boundaries.openTurn({
		...chat,
		closingTurnId: null,
		label: 'ask',
	});
	const ended = boundaries.endTurn(chat);
	await flush();
	assert.deepEqual(held.started, [openingRef(chat)]);

	held.release(openingRef(chat));
	await flush();
	assert.deepEqual(held.started, [openingRef(chat), endingRef(chat)]);

	held.release(endingRef(chat));
	await Promise.all([opened, ended]);
});

test('flushing a chat waits for its last boundary at that moment and for nothing else', async (t) => {
	const fixture = openFixture(t);
	const first = addChat(fixture, fixture.workspaceId);
	const second = addChat(fixture, fixture.workspaceId);
	const held = createHeldCapture();
	const boundaries = createTurnCheckpoints({ capture: held.capture });
	let flushed = false;

	const firstOpened = boundaries.openTurn({
		...first,
		closingTurnId: null,
		label: 'first',
	});
	const secondOpened = boundaries.openTurn({
		...second,
		closingTurnId: null,
		label: 'second',
	});
	const flushing = boundaries.flushSession(first.agentSessionId).then(() => {
		flushed = true;
	});
	const firstEnded = boundaries.endTurn(first);
	await flush();
	assert.equal(flushed, false);

	held.release(openingRef(first));
	await flushing;
	assert.equal(flushed, true);
	assert.deepEqual(held.started, [openingRef(first), openingRef(second)]);

	held.release(openingRef(second));
	await flush();
	held.release(endingRef(first));
	await Promise.all([firstOpened, secondOpened, firstEnded]);
});

test('flushing a chat with nothing queued resolves at once', async () => {
	await createTurnCheckpoints().flushSession('a-chat-that-never-queued');
});

test('a boundary that fails does not stall the ones queued behind it', async (t) => {
	const fixture = openFixture(t);
	const failing = addChat(fixture, fixture.workspaceId);
	const following = addChat(fixture, fixture.workspaceId);
	const boundaries = createTurnCheckpoints({
		capture: async ({ ref }) => ({
			commitHash: 'commit',
			parentHash: null,
			ref,
			treeHash: 'tree',
		}),
	});
	const closedDatabase = {
		prepare: () => {
			throw new Error('database is closed');
		},
	} as unknown as DatabaseSync;

	const discarded = boundaries.discardTurn({
		...failing,
		database: closedDatabase,
	});
	const opened = boundaries.openTurn({
		...following,
		closingTurnId: null,
		label: 'after the failure',
	});

	await assert.rejects(discarded, /database is closed/);
	assert.ok(await opened);
	await boundaries.flushSession(failing.agentSessionId);
	await boundaries.drain();
});

test('drain waits for boundaries in every workspace', async (t) => {
	const fixture = openFixture(t);
	const here = addChat(fixture, fixture.workspaceId);
	const elsewhere = addChat(fixture, 'ws-ckpt-elsewhere');
	const held = createHeldCapture();
	const boundaries = createTurnCheckpoints({ capture: held.capture });
	let drained = false;

	const opened = [
		boundaries.openTurn({ ...here, closingTurnId: null, label: 'here' }),
		boundaries.openTurn({
			...elsewhere,
			closingTurnId: null,
			label: 'elsewhere',
		}),
	];
	const draining = boundaries.drain().then(() => {
		drained = true;
	});
	await flush();

	held.release(openingRef(here));
	await flush();
	assert.equal(drained, false);

	held.release(openingRef(elsewhere));
	await draining;
	assert.equal(drained, true);
	await Promise.all(opened);
});
