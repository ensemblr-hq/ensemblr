import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import type {
	LocalCommandRequest,
	LocalCommandService,
} from '../../src/main/commands/command-types.ts';
import { createLocalCommandService } from '../../src/main/commands/local-command.ts';
import { runWorktreeRemove } from '../../src/main/repository/git-ops.ts';

const BRANCH_NAME = 'octocat/eng-1';

interface Harness {
	repositoryPath: string;
	workspacePath: string;
}

function runGit(cwd: string, args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function createHarness(t: TestContext): Harness {
	const rootPath = mkdtempSync(path.join(tmpdir(), 'ensemblr-wt-remove-'));
	const repositoryPath = path.join(rootPath, 'repo');
	const workspacePath = path.join(rootPath, 'workspaces', 'eng-1');
	mkdirSync(repositoryPath, { recursive: true });

	runGit(repositoryPath, ['init', '-b', 'main']);
	runGit(repositoryPath, ['config', 'user.email', 'test@ensemblr.dev']);
	runGit(repositoryPath, ['config', 'user.name', 'Ensemblr Test']);
	writeFileSync(path.join(repositoryPath, 'README.md'), '# demo\n');
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

	return { repositoryPath, workspacePath };
}

function remove(harness: Harness, deletingWorkspace?: boolean) {
	return runWorktreeRemove({
		deletingWorkspace,
		localCommandService: createLocalCommandService(),
		repositoryPath: harness.repositoryPath,
		workspacePath: harness.workspacePath,
	});
}

const WORKTREE_REMOVE_REFUSAL = {
	status: 'failure',
	stderr: 'fatal: validation failed, cannot remove working tree',
	stdout: '',
	stdoutTruncated: false,
} as Awaited<ReturnType<LocalCommandService['run']>>;

function refuseWorktreeRemove(
	delegate: LocalCommandService,
): LocalCommandService {
	const isWorktreeRemove = (request: LocalCommandRequest): boolean => {
		const [subcommand, action] = request.args ?? [];
		return (
			request.command === 'git' &&
			subcommand === 'worktree' &&
			action === 'remove'
		);
	};

	return {
		getEnvironment: (cwd) => delegate.getEnvironment(cwd),
		run: (request, options) =>
			isWorktreeRemove(request)
				? Promise.resolve(WORKTREE_REMOVE_REFUSAL)
				: delegate.run(request, options),
	};
}

function isRegistered(harness: Harness): boolean {
	return runGit(harness.repositoryPath, ['worktree', 'list', '--porcelain'])
		.split(/\r?\n/)
		.some((line) => line.startsWith('worktree ') && line.endsWith('eng-1'));
}

test('removing a worktree unregisters it and deletes its directory', async (t) => {
	const harness = createHarness(t);

	const outcome = await remove(harness);

	assert.equal(outcome.status, 'success');
	assert.equal(existsSync(harness.workspacePath), false);
	assert.equal(isRegistered(harness), false);
});

// The state the direct unlink exists for, and the reason it cannot be left to
// git: `git worktree remove` drops `.git/worktrees/<id>` even when it then
// fails to delete the tree, and every later `git worktree remove` answers
// "is not a working tree" while the dependencies sit on disk forever.
test('an unregistered worktree still on disk is unlinked directly', async (t) => {
	const harness = createHarness(t);
	mkdirSync(path.join(harness.workspacePath, 'node_modules'), {
		recursive: true,
	});
	rmSync(path.join(harness.repositoryPath, '.git', 'worktrees'), {
		force: true,
		recursive: true,
	});
	assert.equal(isRegistered(harness), false);

	const outcome = await remove(harness);

	assert.equal(outcome.status, 'success');
	assert.equal(existsSync(harness.workspacePath), false);
});

// The unlink runs on git's answer, so no answer must not read as "git dropped
// it" — that is what would let an unreachable repository authorise deleting a
// worktree that is perfectly intact.
test('a repository git cannot read leaves the directory alone', async (t) => {
	const harness = createHarness(t);
	const strayRepository = path.join(harness.repositoryPath, '..', 'not-a-repo');
	mkdirSync(strayRepository, { recursive: true });

	const outcome = await runWorktreeRemove({
		localCommandService: createLocalCommandService(),
		repositoryPath: strayRepository,
		workspacePath: harness.workspacePath,
	});

	assert.equal(outcome.status, 'failure');
	assert.equal(existsSync(harness.workspacePath), true);
});

// The same unanswerable state, with the workspace itself on its way out: there
// is nothing left for git's silence to protect, and leaving the tree behind
// would be the delete quietly failing to delete.
test('a workspace being deleted is removed even when git cannot answer', async (t) => {
	const harness = createHarness(t);
	const strayRepository = path.join(harness.repositoryPath, '..', 'not-a-repo');
	mkdirSync(strayRepository, { recursive: true });

	const outcome = await runWorktreeRemove({
		deletingWorkspace: true,
		localCommandService: createLocalCommandService(),
		repositoryPath: strayRepository,
		workspacePath: harness.workspacePath,
	});

	assert.equal(outcome.status, 'success');
	assert.equal(existsSync(harness.workspacePath), false);
});

// `git worktree remove --force` refuses a locked worktree and keeps both the
// registration and the tree. Unlinking anyway would destroy a worktree the user
// marked do-not-touch and strand `.git/worktrees/<id>`, which `git worktree
// prune` skips while it is locked — so the branch stays checked out forever.
test('a locked worktree is left alone rather than unlinked behind git', async (t) => {
	const harness = createHarness(t);
	runGit(harness.repositoryPath, ['worktree', 'lock', harness.workspacePath]);

	const outcome = await remove(harness);

	assert.equal(outcome.status, 'failure');
	assert.equal(existsSync(harness.workspacePath), true);
	assert.equal(isRegistered(harness), true);
	// The registration is what keeps the branch deletable once the lock is lifted.
	runGit(harness.repositoryPath, ['worktree', 'unlock', harness.workspacePath]);
	assert.equal((await remove(harness)).status, 'success');
	runGit(harness.repositoryPath, ['branch', '-D', BRANCH_NAME]);
});

// Deleting the workspace is explicit intent for the directory, so the lock is
// released through git rather than stepped around — which is what keeps the
// admin entry from outliving the directory and blocking `git branch -D`.
test('deleting the workspace unlocks a locked worktree and removes it through git', async (t) => {
	const harness = createHarness(t);
	runGit(harness.repositoryPath, ['worktree', 'lock', harness.workspacePath]);

	const outcome = await remove(harness, true);

	assert.equal(outcome.status, 'success');
	assert.equal(existsSync(harness.workspacePath), false);
	assert.equal(isRegistered(harness), false);
	runGit(harness.repositoryPath, ['branch', '-D', BRANCH_NAME]);
});

// A removal git keeps refusing leaves the registration in place, and deleting
// the workspace unlinks the directory under it anyway. Git then lists an entry
// pointing at nothing and keeps reporting the branch as checked out — to the
// `git branch -D` that follows, and to every later workspace creation.
test('a registration that outlives its directory is pruned', async (t) => {
	const harness = createHarness(t);

	const outcome = await runWorktreeRemove({
		deletingWorkspace: true,
		localCommandService: refuseWorktreeRemove(createLocalCommandService()),
		repositoryPath: harness.repositoryPath,
		workspacePath: harness.workspacePath,
	});

	assert.equal(outcome.status, 'success');
	assert.equal(existsSync(harness.workspacePath), false);
	assert.equal(isRegistered(harness), false);
	runGit(harness.repositoryPath, ['branch', '-D', BRANCH_NAME]);
});

test('removing an already-absent worktree directory reports success', async (t) => {
	const harness = createHarness(t);
	await remove(harness);

	const outcome = await remove(harness);

	assert.equal(outcome.status, 'success');
});
