import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { createLocalCommandService } from '../../src/main/commands/local-command.ts';
import {
	ARCHIVED_FILES_TO_COPY_DIRECTORY,
	archivedWorktreeRefFor,
	pruneWorktree,
} from '../../src/main/repository/prune-worktree.ts';

const BRANCH_NAME = 'octocat/eng-1';

interface Harness {
	archivedContextPath: string;
	repositoryPath: string;
	workspacePath: string;
}

function runGit(cwd: string, args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function createHarness(t: TestContext): Harness {
	const rootPath = mkdtempSync(path.join(tmpdir(), 'ensemblr-prune-'));
	const repositoryPath = path.join(rootPath, 'repo');
	const workspacePath = path.join(rootPath, 'workspaces', 'eng-1');
	const archivedContextPath = path.join(rootPath, 'archived', 'eng-1');
	mkdirSync(repositoryPath, { recursive: true });
	mkdirSync(archivedContextPath, { recursive: true });

	runGit(repositoryPath, ['init', '-b', 'main']);
	runGit(repositoryPath, ['config', 'user.email', 'test@ensemblr.dev']);
	runGit(repositoryPath, ['config', 'user.name', 'Ensemblr Test']);
	writeFileSync(path.join(repositoryPath, 'README.md'), '# demo\n');
	writeFileSync(path.join(repositoryPath, '.gitignore'), 'node_modules/\n');
	runGit(repositoryPath, ['add', '.']);
	runGit(repositoryPath, ['commit', '-m', 'init']);
	runGit(repositoryPath, [
		'worktree',
		'add',
		'-b',
		BRANCH_NAME,
		workspacePath,
		'main',
	]);

	t.after(() => {
		rmSync(rootPath, { force: true, recursive: true });
	});

	return { archivedContextPath, repositoryPath, workspacePath };
}

function prune(harness: Harness) {
	return pruneWorktree({
		archivedContextPath: harness.archivedContextPath,
		branchName: BRANCH_NAME,
		localCommandService: createLocalCommandService(),
		repositoryPath: harness.repositoryPath,
		workspaceId: 'ws-1',
		workspacePath: harness.workspacePath,
	});
}

function listBranches(repositoryPath: string): string[] {
	return runGit(repositoryPath, [
		'branch',
		'--list',
		'--format=%(refname:short)',
	])
		.split(/\r?\n/)
		.map((branch) => branch.trim())
		.filter((branch) => branch.length > 0);
}

test('pruning removes the worktree and keeps the branch', async (t) => {
	const harness = createHarness(t);

	const outcome = await prune(harness);

	assert.equal(outcome.status, 'pruned');
	assert.equal(existsSync(harness.workspacePath), false);
	assert.ok(listBranches(harness.repositoryPath).includes('octocat/eng-1'));
});

test('pruning pins the branch tip behind a private ref', async (t) => {
	const harness = createHarness(t);
	const tip = runGit(harness.workspacePath, ['rev-parse', 'HEAD']);

	const outcome = await prune(harness);

	assert.equal(outcome.headCommit, tip);
	assert.equal(outcome.wipRef, archivedWorktreeRefFor('ws-1'));
	const pinned = runGit(harness.repositoryPath, [
		'rev-parse',
		`${outcome.wipRef}^{commit}`,
	]);
	assert.equal(pinned, outcome.wipCommit);
	// The snapshot's parent is the branch tip, so the ref keeps the branch's
	// history reachable even once the branch itself is deleted.
	assert.equal(
		runGit(harness.repositoryPath, ['rev-parse', `${outcome.wipRef}^`]),
		tip,
	);
});

test('the prune snapshot carries uncommitted and untracked work', async (t) => {
	const harness = createHarness(t);
	writeFileSync(path.join(harness.workspacePath, 'README.md'), '# edited\n');
	writeFileSync(path.join(harness.workspacePath, 'scratch.txt'), 'untracked\n');
	mkdirSync(path.join(harness.workspacePath, 'node_modules'));
	writeFileSync(
		path.join(harness.workspacePath, 'node_modules', 'big.bin'),
		'x'.repeat(1024),
	);

	const outcome = await prune(harness);
	assert.equal(outcome.status, 'pruned');

	const tree = runGit(harness.repositoryPath, [
		'ls-tree',
		'-r',
		'--name-only',
		`${outcome.wipCommit}`,
	]).split(/\r?\n/);
	assert.ok(tree.includes('scratch.txt'));
	assert.equal(
		runGit(harness.repositoryPath, ['show', `${outcome.wipCommit}:README.md`]),
		'# edited',
	);
	// Ignored paths are exactly what the prune exists to drop, so they must not
	// come back through the snapshot.
	assert.ok(!tree.some((entry) => entry.startsWith('node_modules/')));
});

test('pruning preserves the files-to-copy matches it is about to delete', async (t) => {
	const harness = createHarness(t);
	writeFileSync(path.join(harness.workspacePath, '.env'), 'TOKEN=local\n');

	await prune(harness);

	const preserved = path.join(
		harness.archivedContextPath,
		ARCHIVED_FILES_TO_COPY_DIRECTORY,
		'.env',
	);
	assert.equal(existsSync(preserved), true);
	assert.equal(readFileSync(preserved, 'utf8'), 'TOKEN=local\n');
});

// The snapshot stages with `git add -A`, which honours .gitignore, so a
// files-to-copy match is in no commit anywhere and unarchive has no
// files-to-copy step to re-seed it from. Nowhere to copy it means nowhere to
// get it back from, so the disk stays occupied.
test('a files-to-copy match with nowhere to go keeps the worktree', async (t) => {
	const harness = createHarness(t);
	writeFileSync(path.join(harness.workspacePath, '.env'), 'TOKEN=local\n');

	const outcome = await pruneWorktree({
		archivedContextPath: null,
		branchName: BRANCH_NAME,
		localCommandService: createLocalCommandService(),
		repositoryPath: harness.repositoryPath,
		workspaceId: 'ws-1',
		workspacePath: harness.workspacePath,
	});

	assert.equal(outcome.status, 'failure');
	assert.equal(existsSync(path.join(harness.workspacePath, '.env')), true);
	assert.equal(
		readFileSync(path.join(harness.workspacePath, '.env'), 'utf8'),
		'TOKEN=local\n',
	);
});

// Same absent destination, but nothing gitignored to lose by it: the prune has
// no reason to refuse, and refusing would strand every archive whose context
// directory failed to be created.
test('no files-to-copy match means an absent archive directory is harmless', async (t) => {
	const harness = createHarness(t);

	const outcome = await pruneWorktree({
		archivedContextPath: null,
		branchName: BRANCH_NAME,
		localCommandService: createLocalCommandService(),
		repositoryPath: harness.repositoryPath,
		workspaceId: 'ws-1',
		workspacePath: harness.workspacePath,
	});

	assert.equal(outcome.status, 'pruned');
	assert.equal(existsSync(harness.workspacePath), false);
});

test('pruning an already-absent worktree reports skipped rather than failing', async (t) => {
	const harness = createHarness(t);
	runGit(harness.repositoryPath, [
		'worktree',
		'remove',
		'--force',
		harness.workspacePath,
	]);

	const outcome = await prune(harness);

	assert.equal(outcome.status, 'skipped');
	assert.equal(outcome.wipCommit, null);
});

test('a worktree that cannot be snapshotted is kept rather than reclaimed', async (t) => {
	const harness = createHarness(t);
	// A directory git cannot read as a repository is the failure that must never
	// cost the user their files: refusing to reclaim disk is the safe outcome.
	const detached = path.join(harness.workspacePath, '..', 'not-a-worktree');
	mkdirSync(detached, { recursive: true });
	writeFileSync(path.join(detached, 'keep.txt'), 'keep\n');

	const outcome = await pruneWorktree({
		archivedContextPath: harness.archivedContextPath,
		branchName: BRANCH_NAME,
		localCommandService: createLocalCommandService(),
		repositoryPath: harness.repositoryPath,
		workspaceId: 'ws-detached',
		workspacePath: detached,
	});

	assert.equal(outcome.status, 'failure');
	assert.equal(existsSync(path.join(detached, 'keep.txt')), true);
});

test('a worktree git no longer knows about is reclaimed from its snapshot', async (t) => {
	const harness = createHarness(t);
	// What `git worktree remove` leaves behind when it unregisters the worktree
	// and then fails to delete it: a directory git cannot read, repair, or
	// re-register, holding the dependencies the archive was meant to reclaim.
	const snapshot = await prune(harness);
	assert.equal(snapshot.status, 'pruned');
	mkdirSync(path.join(harness.workspacePath, 'node_modules'), {
		recursive: true,
	});
	writeFileSync(path.join(harness.workspacePath, '.git'), 'gitdir: gone\n');

	const outcome = await prune(harness);

	assert.equal(outcome.status, 'pruned');
	assert.equal(existsSync(harness.workspacePath), false);
	assert.equal(outcome.wipCommit, snapshot.wipCommit);
	assert.equal(outcome.headCommit, snapshot.headCommit);
});

// The archive ref outlives its own prune whenever the best-effort ref delete an
// unarchive runs does not land. A snapshot from a cycle the branch has since
// moved past is not this worktree's state, and reclaiming against it would
// destroy the work in between while reporting the archive as recoverable.
test('a snapshot the branch has moved past is refused', async (t) => {
	const harness = createHarness(t);
	const stale = await prune(harness);
	assert.equal(stale.status, 'pruned');
	runGit(harness.repositoryPath, [
		'worktree',
		'add',
		harness.workspacePath,
		BRANCH_NAME,
	]);
	writeFileSync(path.join(harness.workspacePath, 'later.txt'), 'later\n');
	runGit(harness.workspacePath, ['add', '.']);
	runGit(harness.workspacePath, [
		'commit',
		'-m',
		'work done since the archive',
	]);
	writeFileSync(path.join(harness.workspacePath, 'unsaved.txt'), 'work\n');
	writeFileSync(path.join(harness.workspacePath, '.git'), 'gitdir: gone\n');

	const outcome = await prune(harness);

	assert.equal(outcome.status, 'failure');
	assert.equal(
		existsSync(path.join(harness.workspacePath, 'unsaved.txt')),
		true,
	);
});

// A worktree that is intact but has no commit on HEAD yet reads as unreadable
// to `rev-parse HEAD`, and its contents are still the only copy of themselves.
test('a worktree on an unborn branch is not treated as unreadable', async (t) => {
	const harness = createHarness(t);
	const emptyRepository = path.join(harness.repositoryPath, '..', 'empty');
	mkdirSync(emptyRepository, { recursive: true });
	runGit(emptyRepository, ['init', '-b', 'main']);
	writeFileSync(path.join(emptyRepository, 'unsaved.txt'), 'work\n');

	const outcome = await pruneWorktree({
		archivedContextPath: harness.archivedContextPath,
		branchName: 'main',
		localCommandService: createLocalCommandService(),
		repositoryPath: emptyRepository,
		workspaceId: 'ws-1',
		workspacePath: emptyRepository,
	});

	assert.equal(outcome.status, 'failure');
	assert.equal(existsSync(path.join(emptyRepository, 'unsaved.txt')), true);
});

test('an unreadable worktree with no snapshot to fall back on is kept', async (t) => {
	const harness = createHarness(t);
	writeFileSync(path.join(harness.workspacePath, '.git'), 'gitdir: gone\n');
	writeFileSync(path.join(harness.workspacePath, 'unsaved.txt'), 'work\n');

	const outcome = await prune(harness);

	assert.equal(outcome.status, 'failure');
	assert.equal(
		existsSync(path.join(harness.workspacePath, 'unsaved.txt')),
		true,
	);
});
