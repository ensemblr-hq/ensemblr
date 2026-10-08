import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createLocalCommandService } from '../../src/main/commands/local-command';
import { fastForwardLocalBase } from '../../src/main/repository/base-fast-forward.ts';

interface Harness {
	/** A second clone standing in for GitHub and whoever merges into it. */
	collaboratorPath: string;
	/** The repository root Ensemblr cuts workspaces from, on `master`. */
	repositoryPath: string;
	tempPath: string;
}

const harnesses: Harness[] = [];

afterEach(() => {
	for (const harness of harnesses.splice(0)) {
		rmSync(harness.tempPath, { force: true, recursive: true });
	}
});

function runGit(cwd: string, args: string[]): string {
	return execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		stdio: 'pipe',
	}).trim();
}

function configureIdentity(cwd: string): void {
	runGit(cwd, ['config', 'user.email', 'test@ensemblr.dev']);
	runGit(cwd, ['config', 'user.name', 'Ensemblr Test']);
	runGit(cwd, ['config', 'commit.gpgsign', 'false']);
}

function commitFile(cwd: string, name: string, contents: string): string {
	writeFileSync(path.join(cwd, name), contents);
	runGit(cwd, ['add', name]);
	runGit(cwd, ['commit', '-m', `write ${name}`]);
	return runGit(cwd, ['rev-parse', 'HEAD']);
}

/** Lands a commit on origin's `master`, the way a merged pull request does. */
function mergeUpstream(
	harness: Harness,
	name: string,
	contents: string,
): string {
	const merged = commitFile(harness.collaboratorPath, name, contents);
	runGit(harness.collaboratorPath, ['push', 'origin', 'master']);
	return merged;
}

function createHarness(): Harness {
	const tempPath = mkdtempSync(path.join(tmpdir(), 'ensemblr-base-ff-'));
	const originPath = path.join(tempPath, 'origin.git');
	const collaboratorPath = path.join(tempPath, 'collaborator');
	const repositoryPath = path.join(tempPath, 'repository');
	runGit(tempPath, ['init', '--bare', '--initial-branch=master', originPath]);
	runGit(tempPath, ['clone', originPath, collaboratorPath]);
	configureIdentity(collaboratorPath);
	runGit(collaboratorPath, ['checkout', '-b', 'master']);
	commitFile(collaboratorPath, 'README.md', 'one\n');
	commitFile(collaboratorPath, 'notes.md', 'notes\n');
	runGit(collaboratorPath, ['push', '-u', 'origin', 'master']);
	runGit(tempPath, ['clone', originPath, repositoryPath]);
	configureIdentity(repositoryPath);
	const harness = { collaboratorPath, repositoryPath, tempPath };
	harnesses.push(harness);
	return harness;
}

function fastForward(harness: Harness, baseBranch = 'origin/master') {
	return fastForwardLocalBase({
		baseBranch,
		localCommandService: createLocalCommandService(),
		repositoryPath: harness.repositoryPath,
	});
}

function localMaster(harness: Harness): string {
	return runGit(harness.repositoryPath, ['rev-parse', 'refs/heads/master']);
}

describe('fastForwardLocalBase', () => {
	it('fast-forwards the base checked out in the repository root, files and all', async () => {
		const harness = createHarness();
		const before = localMaster(harness);
		const merged = mergeUpstream(harness, 'README.md', 'two\n');

		const outcome = await fastForward(harness);

		expect(outcome).toEqual({
			branch: 'master',
			from: before,
			status: 'fast-forwarded',
			to: merged,
		});
		expect(localMaster(harness)).toBe(merged);
		expect(
			readFileSync(path.join(harness.repositoryPath, 'README.md'), 'utf8'),
		).toBe('two\n');
	});

	it('accepts a bare branch name as the base', async () => {
		const harness = createHarness();
		const merged = mergeUpstream(harness, 'README.md', 'two\n');

		const outcome = await fastForward(harness, 'master');

		expect(outcome.status).toBe('fast-forwarded');
		expect(localMaster(harness)).toBe(merged);
	});

	it('keeps an uncommitted edit the merge does not touch, like git pull --ff-only', async () => {
		const harness = createHarness();
		writeFileSync(path.join(harness.repositoryPath, 'notes.md'), 'mine\n');
		const merged = mergeUpstream(harness, 'README.md', 'two\n');

		const outcome = await fastForward(harness);

		expect(outcome.status).toBe('fast-forwarded');
		expect(localMaster(harness)).toBe(merged);
		expect(
			readFileSync(path.join(harness.repositoryPath, 'notes.md'), 'utf8'),
		).toBe('mine\n');
	});

	it('refuses a move that would overwrite an uncommitted edit', async () => {
		const harness = createHarness();
		const before = localMaster(harness);
		writeFileSync(path.join(harness.repositoryPath, 'README.md'), 'mine\n');
		mergeUpstream(harness, 'README.md', 'two\n');

		const outcome = await fastForward(harness);

		expect(outcome).toMatchObject({ branch: 'master', status: 'blocked' });
		expect(outcome.status === 'blocked' && outcome.detail).toBeTruthy();
		expect(localMaster(harness)).toBe(before);
		expect(
			readFileSync(path.join(harness.repositoryPath, 'README.md'), 'utf8'),
		).toBe('mine\n');
	});

	it('moves only the ref when nothing has the base checked out', async () => {
		const harness = createHarness();
		runGit(harness.repositoryPath, ['switch', '-c', 'feature']);
		const merged = mergeUpstream(harness, 'README.md', 'two\n');

		const outcome = await fastForward(harness);

		expect(outcome.status).toBe('fast-forwarded');
		expect(localMaster(harness)).toBe(merged);
		expect(
			runGit(harness.repositoryPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
		).toBe('feature');
		expect(
			readFileSync(path.join(harness.repositoryPath, 'README.md'), 'utf8'),
		).toBe('one\n');
	});

	it('leaves a base with commits of its own alone', async () => {
		const harness = createHarness();
		const local = commitFile(harness.repositoryPath, 'local.md', 'local\n');
		mergeUpstream(harness, 'README.md', 'two\n');

		const outcome = await fastForward(harness);

		expect(outcome).toEqual({
			branch: 'master',
			status: 'diverged',
			upstreamRef: 'origin/master',
		});
		expect(localMaster(harness)).toBe(local);
	});

	it('reports a base that already matches its upstream', async () => {
		const harness = createHarness();

		const outcome = await fastForward(harness);

		expect(outcome).toEqual({ branch: 'master', status: 'up-to-date' });
	});

	it('never moves a base another worktree has checked out', async () => {
		const harness = createHarness();
		const before = localMaster(harness);
		const worktreePath = path.join(harness.tempPath, 'workspace');
		runGit(harness.repositoryPath, ['switch', '-c', 'feature']);
		runGit(harness.repositoryPath, ['worktree', 'add', worktreePath, 'master']);
		mergeUpstream(harness, 'README.md', 'two\n');

		const outcome = await fastForward(harness);

		expect(outcome).toMatchObject({
			branch: 'master',
			status: 'checked-out-elsewhere',
		});
		expect(localMaster(harness)).toBe(before);
	});

	it('reports a base with no upstream to follow', async () => {
		const harness = createHarness();
		runGit(harness.repositoryPath, ['branch', 'topic']);

		const outcome = await fastForward(harness, 'topic');

		expect(outcome).toEqual({ branch: 'topic', status: 'no-upstream' });
	});

	it('reports a base with no local branch', async () => {
		const harness = createHarness();
		runGit(harness.collaboratorPath, ['push', 'origin', 'master:release']);
		runGit(harness.repositoryPath, ['fetch', 'origin']);

		const outcome = await fastForward(harness, 'origin/release');

		expect(outcome).toEqual({ branch: 'release', status: 'no-local-branch' });
	});

	it('reports a fetch that failed without moving anything', async () => {
		const harness = createHarness();
		const before = localMaster(harness);
		runGit(harness.repositoryPath, [
			'remote',
			'set-url',
			'origin',
			path.join(harness.tempPath, 'missing.git'),
		]);

		const outcome = await fastForward(harness);

		expect(outcome).toEqual({
			branch: 'master',
			status: 'fetch-failed',
			upstreamRef: 'origin/master',
		});
		expect(localMaster(harness)).toBe(before);
	});

	it('refuses to fetch an upstream branch git would read as a flag', async () => {
		const harness = createHarness();
		runGit(harness.repositoryPath, [
			'update-ref',
			'refs/remotes/origin/-upload-pack=evil',
			'HEAD',
		]);
		runGit(harness.repositoryPath, [
			'config',
			'branch.master.merge',
			'refs/heads/-upload-pack=evil',
		]);

		const outcome = await fastForward(harness);

		expect(outcome).toEqual({
			branch: 'master',
			status: 'fetch-failed',
			upstreamRef: 'origin/-upload-pack=evil',
		});
	});

	it('refuses a base that is not a usable branch name', async () => {
		const harness = createHarness();

		const outcome = await fastForward(harness, '--upload-pack=evil');

		expect(outcome.status).toBe('unavailable');
	});
});
