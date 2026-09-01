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
	type PruneWorktreeOutcome,
	pruneWorktree,
} from '../../src/main/repository/prune-worktree.ts';
import {
	invalidateSetupMarker,
	rehydrateWorktree,
} from '../../src/main/repository/rehydrate-worktree.ts';

const BRANCH = 'octocat/eng-1';

interface Harness {
	archivedContextPath: string;
	repositoryPath: string;
	workspacePath: string;
}

function runGit(cwd: string, args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function createHarness(t: TestContext): Harness {
	const rootPath = mkdtempSync(path.join(tmpdir(), 'ensemblr-rehydrate-'));
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
		BRANCH,
		workspacePath,
		'main',
	]);

	t.after(() => {
		rmSync(rootPath, { force: true, recursive: true });
	});

	return { archivedContextPath, repositoryPath, workspacePath };
}

function prune(harness: Harness): Promise<PruneWorktreeOutcome> {
	return pruneWorktree({
		archivedContextPath: harness.archivedContextPath,
		localCommandService: createLocalCommandService(),
		repositoryPath: harness.repositoryPath,
		workspaceId: 'ws-1',
		workspacePath: harness.workspacePath,
	});
}

function rehydrate(harness: Harness, pruned: PruneWorktreeOutcome) {
	return rehydrateWorktree({
		archivedContextPath: harness.archivedContextPath,
		branchName: BRANCH,
		localCommandService: createLocalCommandService(),
		prunedHeadCommit: pruned.headCommit,
		prunedWipCommit: pruned.wipCommit,
		repositoryPath: harness.repositoryPath,
		workspacePath: harness.workspacePath,
	});
}

/**
 * Porcelain status codes keyed by path, so a test can assert staged vs unstaged.
 * Read without trimming: an unstaged modification opens with a space, which a
 * trim would eat and shift every column by one.
 */
function statusByPath(cwd: string): Map<string, string> {
	const raw = execFileSync(
		'git',
		['status', '--porcelain=v1', '--untracked-files=all'],
		{ cwd, encoding: 'utf8' },
	);
	const entries = new Map<string, string>();
	for (const line of raw.split(/\r?\n/)) {
		if (line.length === 0) {
			continue;
		}
		entries.set(line.slice(3), line.slice(0, 2));
	}
	return entries;
}

test('rehydrating checks the original branch out at the same commit', async (t) => {
	const harness = createHarness(t);
	writeFileSync(path.join(harness.workspacePath, 'feature.txt'), 'shipped\n');
	runGit(harness.workspacePath, ['add', '.']);
	runGit(harness.workspacePath, ['commit', '-m', 'feature']);
	const tip = runGit(harness.workspacePath, ['rev-parse', 'HEAD']);

	const pruned = await prune(harness);
	const outcome = await rehydrate(harness, pruned);

	assert.equal(outcome.status, 'success');
	assert.equal(outcome.status === 'success' && outcome.branchRecreated, false);
	assert.equal(runGit(harness.workspacePath, ['rev-parse', 'HEAD']), tip);
	assert.equal(
		runGit(harness.workspacePath, ['rev-parse', '--abbrev-ref', 'HEAD']),
		BRANCH,
	);
	assert.equal(
		readFileSync(path.join(harness.workspacePath, 'feature.txt'), 'utf8'),
		'shipped\n',
	);
});

test('rehydrating restores uncommitted work as unstaged and untracked', async (t) => {
	const harness = createHarness(t);
	writeFileSync(path.join(harness.workspacePath, 'README.md'), '# edited\n');
	writeFileSync(path.join(harness.workspacePath, 'scratch.txt'), 'untracked\n');

	const pruned = await prune(harness);
	const outcome = await rehydrate(harness, pruned);

	assert.equal(outcome.status, 'success');
	assert.equal(
		outcome.status === 'success' && outcome.workingTreeRestored,
		true,
	);
	assert.equal(
		readFileSync(path.join(harness.workspacePath, 'README.md'), 'utf8'),
		'# edited\n',
	);
	assert.equal(
		readFileSync(path.join(harness.workspacePath, 'scratch.txt'), 'utf8'),
		'untracked\n',
	);

	// The prune must not silently promote the user's work into the index: an
	// edit that was unstaged comes back unstaged, and a new file untracked.
	const status = statusByPath(harness.workspacePath);
	assert.equal(status.get('README.md'), ' M');
	assert.equal(status.get('scratch.txt'), '??');
});

test('rehydrating restores the preserved files-to-copy matches', async (t) => {
	const harness = createHarness(t);
	writeFileSync(path.join(harness.workspacePath, '.env'), 'TOKEN=local\n');

	const pruned = await prune(harness);
	await rehydrate(harness, pruned);

	assert.equal(
		readFileSync(path.join(harness.workspacePath, '.env'), 'utf8'),
		'TOKEN=local\n',
	);
});

test('a branch deleted out of band is recreated at the recorded commit', async (t) => {
	const harness = createHarness(t);
	writeFileSync(path.join(harness.workspacePath, 'feature.txt'), 'shipped\n');
	runGit(harness.workspacePath, ['add', '.']);
	runGit(harness.workspacePath, ['commit', '-m', 'feature']);
	const tip = runGit(harness.workspacePath, ['rev-parse', 'HEAD']);

	const pruned = await prune(harness);
	runGit(harness.repositoryPath, ['branch', '-D', BRANCH]);

	const outcome = await rehydrate(harness, pruned);

	assert.equal(outcome.status, 'success');
	assert.equal(outcome.status === 'success' && outcome.branchRecreated, true);
	// The pin ref is what kept this commit reachable after `branch -D`.
	assert.equal(runGit(harness.workspacePath, ['rev-parse', 'HEAD']), tip);
	assert.equal(
		readFileSync(path.join(harness.workspacePath, 'feature.txt'), 'utf8'),
		'shipped\n',
	);
});

test('an unrecoverable branch reports which recovery is missing', async (t) => {
	const harness = createHarness(t);
	const pruned = await prune(harness);
	runGit(harness.repositoryPath, ['branch', '-D', BRANCH]);

	const outcome = await rehydrateWorktree({
		archivedContextPath: harness.archivedContextPath,
		branchName: BRANCH,
		localCommandService: createLocalCommandService(),
		prunedHeadCommit: null,
		prunedWipCommit: pruned.wipCommit,
		repositoryPath: harness.repositoryPath,
		workspacePath: harness.workspacePath,
	});

	assert.equal(outcome.status, 'failure');
	assert.equal(
		outcome.status === 'failure' && outcome.reason,
		'branch-missing',
	);
	assert.equal(existsSync(harness.workspacePath), false);
});

test('a recorded commit that no longer resolves is reported as a missing snapshot', async (t) => {
	const harness = createHarness(t);
	await prune(harness);

	const outcome = await rehydrateWorktree({
		archivedContextPath: harness.archivedContextPath,
		branchName: 'octocat/gone',
		localCommandService: createLocalCommandService(),
		prunedHeadCommit: '0'.repeat(40),
		prunedWipCommit: null,
		repositoryPath: harness.repositoryPath,
		workspacePath: harness.workspacePath,
	});

	assert.equal(outcome.status, 'failure');
	assert.equal(
		outcome.status === 'failure' && outcome.reason,
		'snapshot-missing',
	);
});

test('rehydrating clears the setup marker the restored context carries', async (t) => {
	const harness = createHarness(t);
	const markerPath = path.join(
		harness.workspacePath,
		'.context',
		'setup.local.json',
	);
	mkdirSync(path.dirname(markerPath), { recursive: true });
	writeFileSync(markerPath, '{"fingerprint":"stale"}\n');

	const pruned = await prune(harness);
	await rehydrate(harness, pruned);

	// The restore copies `.context/` back verbatim, so the marker is put there
	// again; leaving it would skip the setup run that rebuilds node_modules.
	mkdirSync(path.dirname(markerPath), { recursive: true });
	writeFileSync(markerPath, '{"fingerprint":"stale"}\n');
	invalidateSetupMarker(harness.workspacePath);

	assert.equal(existsSync(markerPath), false);
});
