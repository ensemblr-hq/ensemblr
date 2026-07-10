import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

import type {
	LocalCommandRequest,
	LocalCommandResult,
	LocalCommandService,
} from '../../src/main/commands/local-command';
import {
	parseNameStatus,
	parseNumstat,
	parsePorcelainStatus,
} from '../../src/main/workspace-git/workspace-git-parsers.ts';
import { createWorkspaceGitService } from '../../src/main/workspace-git/workspace-git-status.ts';

const fixedNow = () => new Date('2026-06-11T12:00:00.000Z');

function buildResult(
	overrides: Partial<LocalCommandResult> = {},
): LocalCommandResult {
	return {
		args: [],
		command: 'git',
		cwd: '/tmp',
		durationMs: 0,
		endedAt: fixedNow().toISOString(),
		environment: null,
		exitCode: 0,
		logs: { command: 'git', cwd: '/tmp', env: {}, stderr: '', stdout: '' },
		signal: null,
		startedAt: fixedNow().toISOString(),
		status: 'success',
		stderr: '',
		stderrTruncated: false,
		stdout: '',
		stdoutTruncated: false,
		...overrides,
	};
}

function stubCommandService(
	respond: (request: LocalCommandRequest) => LocalCommandResult,
): { calls: LocalCommandRequest[]; service: LocalCommandService } {
	const calls: LocalCommandRequest[] = [];
	return {
		calls,
		service: {
			getEnvironment: async () => ({
				diagnostics: [],
				env: {},
				path: '',
				resolvedAt: fixedNow().toISOString(),
				shell: '/bin/zsh',
				source: 'fallback',
			}),
			run: async (request) => {
				calls.push(request);
				return respond(request);
			},
		},
	};
}

/** Runs real `git` so integration tests can assert actual repo mutations. */
function realCommandService(): LocalCommandService {
	return {
		getEnvironment: async () => ({
			diagnostics: [],
			env: {},
			path: '',
			resolvedAt: fixedNow().toISOString(),
			shell: '/bin/zsh',
			source: 'fallback',
		}),
		run: async (request) => {
			const args = [...(request.args ?? [])];
			try {
				const { stdout, stderr } = await execFileAsync('git', args, {
					cwd: request.cwd,
					maxBuffer: 16 * 1024 * 1024,
				});
				return buildResult({ args, cwd: request.cwd, stderr, stdout });
			} catch (error) {
				const failure = error as { code?: number; stderr?: string };
				return buildResult({
					args,
					cwd: request.cwd,
					exitCode: typeof failure.code === 'number' ? failure.code : 1,
					status: 'failure',
					stderr: failure.stderr ?? '',
				});
			}
		},
	};
}

test('parsePorcelainStatus classifies common entries', () => {
	const stdout = [
		' M src/app.ts',
		'A  src/new.ts',
		'D  src/gone.ts',
		'?? notes.md',
		'UU conflict.ts',
	].join('\0');
	const entries = parsePorcelainStatus(`${stdout}\0`);

	assert.deepEqual(
		entries.map((entry) => [entry.path, entry.status]),
		[
			['src/app.ts', 'modified'],
			['src/new.ts', 'added'],
			['src/gone.ts', 'deleted'],
			['notes.md', 'untracked'],
			['conflict.ts', 'conflicted'],
		],
	);
});

test('parsePorcelainStatus reads rename original path from next token', () => {
	const stdout = 'R  src/renamed.ts\0src/original.ts\0 M other.ts\0';
	const entries = parsePorcelainStatus(stdout);

	assert.deepEqual(entries, [
		{
			path: 'src/renamed.ts',
			renamedFrom: 'src/original.ts',
			status: 'renamed',
		},
		{ path: 'other.ts', status: 'modified' },
	]);
});

test('parseNumstat parses counts, binary markers, and renames', () => {
	const stdout = [
		'3\t1\tsrc/app.ts\0',
		'-\t-\tassets/logo.png\0',
		'2\t0\t\0src/old.ts\0src/new.ts\0',
	].join('');
	const counts = parseNumstat(stdout);

	assert.deepEqual(counts.get('src/app.ts'), { additions: 3, deletions: 1 });
	assert.deepEqual(counts.get('assets/logo.png'), {
		additions: null,
		deletions: null,
	});
	assert.deepEqual(counts.get('src/new.ts'), { additions: 2, deletions: 0 });
});

test('getStatus merges porcelain entries with numstat counts', async (t) => {
	const workspaceDir = await mkdtemp(path.join(tmpdir(), 'ensemblr-git-'));
	t.after(() => rm(workspaceDir, { force: true, recursive: true }));
	await writeFile(path.join(workspaceDir, 'notes.md'), 'one\ntwo\n');

	const { service } = stubCommandService((request) => {
		if (request.args?.[0] === 'status') {
			return buildResult({ stdout: ' M src/app.ts\0?? notes.md\0' });
		}
		return buildResult({ stdout: '5\t2\tsrc/app.ts\0' });
	});
	const git = createWorkspaceGitService({ localCommandService: service });

	const result = await git.getStatus({ workspaceCwd: workspaceDir });

	assert.equal(result.error, undefined);
	assert.deepEqual(result.files, [
		{ additions: 5, deletions: 2, path: 'src/app.ts', status: 'modified' },
		{ additions: 2, deletions: 0, path: 'notes.md', status: 'untracked' },
	]);
	assert.deepEqual(result.summary, { additions: 7, deletions: 2, files: 2 });
});

test('getStatus expands untracked directories with --untracked-files=all', async (t) => {
	const workspaceDir = await mkdtemp(path.join(tmpdir(), 'ensemblr-git-'));
	t.after(() => rm(workspaceDir, { force: true, recursive: true }));
	const { calls, service } = stubCommandService((request) => {
		if (request.args?.[0] === 'status') {
			// Mirror git's expanded output: individual files, never a bare `src/`.
			return buildResult({
				stdout: '?? .DS_Store\0?? src/models/user.ts\0',
			});
		}
		return buildResult({ stdout: '' });
	});
	const git = createWorkspaceGitService({ localCommandService: service });

	const result = await git.getStatus({ workspaceCwd: workspaceDir });

	const statusCall = calls.find((call) => call.args?.[0] === 'status');
	// Without this flag git collapses a new folder to one un-openable `src/`
	// row, which is what made the folder/list toggle look like a no-op.
	assert.ok(
		statusCall?.args?.includes('--untracked-files=all'),
		'git status must request every untracked file',
	);
	assert.deepEqual(
		result.files.map((file) => file.path),
		['.DS_Store', 'src/models/user.ts'],
	);
});

test('discardChanges reverts a tracked file to HEAD', async (t) => {
	const workspaceDir = await mkdtemp(path.join(tmpdir(), 'ensemblr-git-'));
	t.after(() => rm(workspaceDir, { force: true, recursive: true }));
	// All git calls succeed: `cat-file -e HEAD:path` success means the file is in
	// HEAD, so the tracked-revert branch runs `git checkout`.
	const { calls, service } = stubCommandService(() => buildResult());
	const git = createWorkspaceGitService({ localCommandService: service });

	const result = await git.discardChanges({
		paths: ['src/app.ts'],
		workspaceCwd: workspaceDir,
	});

	assert.equal(result.error, undefined);
	assert.deepEqual(result.discarded, ['src/app.ts']);
	const checkout = calls.find((call) => call.args?.[0] === 'checkout');
	assert.deepEqual(checkout?.args, ['checkout', 'HEAD', '--', 'src/app.ts']);
});

test('discardChanges deletes a new/untracked file from disk', async (t) => {
	const workspaceDir = await mkdtemp(path.join(tmpdir(), 'ensemblr-git-'));
	t.after(() => rm(workspaceDir, { force: true, recursive: true }));
	const filePath = path.join(workspaceDir, 'fresh.ts');
	await writeFile(filePath, 'export const x = 1;\n');

	const { calls, service } = stubCommandService((request) => {
		if (request.args?.[0] === 'cat-file') {
			// Absent from HEAD → new/untracked branch (unstage + delete).
			return buildResult({
				exitCode: 128,
				status: 'failure',
				stderr: "fatal: path 'fresh.ts' does not exist in 'HEAD'",
			});
		}
		return buildResult();
	});
	const git = createWorkspaceGitService({ localCommandService: service });

	const result = await git.discardChanges({
		paths: ['fresh.ts'],
		workspaceCwd: workspaceDir,
	});

	assert.deepEqual(result.discarded, ['fresh.ts']);
	const unstage = calls.find((call) => call.args?.[0] === 'rm');
	assert.ok(unstage?.args?.includes('--cached'));
	assert.ok(unstage?.args?.includes('--ignore-unmatch'));
	// The working-tree copy is gone.
	await assert.rejects(access(filePath));
});

test('discardChanges (real git) reverts a tracked edit and deletes a new file', async (t) => {
	const dir = await mkdtemp(path.join(tmpdir(), 'ensemblr-git-real-'));
	t.after(() => rm(dir, { force: true, recursive: true }));
	const git = (...args: string[]) => execFileAsync('git', args, { cwd: dir });
	await git('init', '-q');
	await git('config', 'user.email', 'test@example.com');
	await git('config', 'user.name', 'Test');
	await writeFile(path.join(dir, 'tracked.ts'), 'committed\n');
	await git('add', '.');
	await git('commit', '-q', '-m', 'init');
	// Modify the tracked file and add a brand-new untracked file.
	await writeFile(path.join(dir, 'tracked.ts'), 'local edit\n');
	await writeFile(path.join(dir, 'new.ts'), 'brand new\n');

	const service = createWorkspaceGitService({
		localCommandService: realCommandService(),
	});
	const result = await service.discardChanges({
		paths: ['tracked.ts', 'new.ts'],
		workspaceCwd: dir,
	});

	assert.equal(result.error, undefined);
	assert.deepEqual([...result.discarded].sort(), ['new.ts', 'tracked.ts']);
	// The tracked edit is reverted to the committed content…
	assert.equal(
		await readFile(path.join(dir, 'tracked.ts'), 'utf8'),
		'committed\n',
	);
	// …and the new file is gone from disk.
	await assert.rejects(access(path.join(dir, 'new.ts')));
});

test('discardChanges rejects paths escaping the workspace', async (t) => {
	const workspaceDir = await mkdtemp(path.join(tmpdir(), 'ensemblr-git-'));
	t.after(() => rm(workspaceDir, { force: true, recursive: true }));
	const { calls, service } = stubCommandService(() => buildResult());
	const git = createWorkspaceGitService({ localCommandService: service });

	const result = await git.discardChanges({
		paths: ['../escape.ts'],
		workspaceCwd: workspaceDir,
	});

	assert.equal(result.error?.code, 'invalid-path');
	assert.deepEqual(result.discarded, []);
	assert.equal(calls.length, 0);
});

test('getStatus surfaces not-a-git-repo failures', async () => {
	const { service } = stubCommandService(() =>
		buildResult({
			exitCode: 128,
			status: 'failure',
			stderr: 'fatal: not a git repository (or any of the parent directories)',
		}),
	);
	const git = createWorkspaceGitService({ localCommandService: service });

	const result = await git.getStatus({ workspaceCwd: '/tmp/nowhere' });

	assert.equal(result.error?.code, 'not-a-git-repo');
	assert.deepEqual(result.files, []);
	assert.deepEqual(result.summary, { additions: 0, deletions: 0, files: 0 });
});

test('getStatus rejects relative workspace paths', async () => {
	const { calls, service } = stubCommandService(() => buildResult());
	const git = createWorkspaceGitService({ localCommandService: service });

	const result = await git.getStatus({ workspaceCwd: 'relative/path' });

	assert.equal(result.error?.code, 'invalid-cwd');
	assert.equal(calls.length, 0);
});

test('getFileDiff returns tracked diff output', async () => {
	const patch = 'diff --git a/src/app.ts b/src/app.ts\n+added line\n';
	const { calls, service } = stubCommandService(() =>
		buildResult({ stdout: patch }),
	);
	const git = createWorkspaceGitService({ localCommandService: service });

	const result = await git.getFileDiff({
		path: 'src/app.ts',
		workspaceCwd: '/tmp/repo',
	});

	assert.equal(result.patch, patch);
	assert.equal(result.error, undefined);
	assert.deepEqual(calls[0]?.args?.slice(0, 3), ['diff', '--no-color', 'HEAD']);
});

test('getFileDiff falls back to no-index for untracked files', async () => {
	const patch = 'diff --git a/dev/null b/notes.md\n+new file\n';
	const { calls, service } = stubCommandService((request) => {
		if (request.args?.includes('--no-index')) {
			return buildResult({ exitCode: 1, status: 'failure', stdout: patch });
		}
		return buildResult({ stdout: '' });
	});
	const git = createWorkspaceGitService({ localCommandService: service });

	const result = await git.getFileDiff({
		path: 'notes.md',
		workspaceCwd: '/tmp/repo',
	});

	assert.equal(result.patch, patch);
	assert.equal(result.error, undefined);
	assert.equal(calls.length, 2);
});

test('getFileDiff rejects escaping paths', async () => {
	const { calls, service } = stubCommandService(() => buildResult());
	const git = createWorkspaceGitService({ localCommandService: service });

	const result = await git.getFileDiff({
		path: '../outside.txt',
		workspaceCwd: '/tmp/repo',
	});

	assert.equal(result.error?.code, 'invalid-path');
	assert.equal(calls.length, 0);
});

test('parseNameStatus classifies entries and reads rename paths', () => {
	const stdout = `${[
		'M',
		'src/app.ts',
		'A',
		'src/new.ts',
		'D',
		'src/gone.ts',
		'R100',
		'src/old.ts',
		'src/renamed.ts',
		'T',
		'src/mode.ts',
	].join('\0')}\0`;
	const entries = parseNameStatus(stdout);

	assert.deepEqual(entries, [
		{ path: 'src/app.ts', status: 'modified' },
		{ path: 'src/new.ts', status: 'added' },
		{ path: 'src/gone.ts', status: 'deleted' },
		{ path: 'src/renamed.ts', renamedFrom: 'src/old.ts', status: 'renamed' },
		// A type-change (T) is surfaced as a modification.
		{ path: 'src/mode.ts', status: 'modified' },
	]);
});

test("getStatus (real git) returns a single commit's files for commit scope", async (t) => {
	const dir = await mkdtemp(path.join(tmpdir(), 'ensemblr-git-commit-'));
	t.after(() => rm(dir, { force: true, recursive: true }));
	const git = (...args: string[]) => execFileAsync('git', args, { cwd: dir });
	await git('init', '-q');
	await git('config', 'user.email', 'test@example.com');
	await git('config', 'user.name', 'Test');
	await writeFile(path.join(dir, 'a.ts'), 'one\n');
	await git('add', '.');
	await git('commit', '-q', '-m', 'first');
	// Second commit modifies a.ts and adds b.ts.
	await writeFile(path.join(dir, 'a.ts'), 'one\nmore\n');
	await writeFile(path.join(dir, 'b.ts'), 'two\n');
	await git('add', '.');
	await git('commit', '-q', '-m', 'second');

	const headHash = (await git('rev-parse', 'HEAD')).stdout.trim();
	const firstHash = (await git('rev-parse', 'HEAD~1')).stdout.trim();
	const service = createWorkspaceGitService({
		localCommandService: realCommandService(),
	});

	const head = await service.getStatus({
		scope: { commitHash: headHash, kind: 'commit' },
		workspaceCwd: dir,
	});
	assert.equal(head.error, undefined);
	assert.deepEqual(head.files.map((file) => [file.path, file.status]).sort(), [
		['a.ts', 'modified'],
		['b.ts', 'added'],
	]);

	// The root commit diffs against the empty tree, so its file reads as added.
	const root = await service.getStatus({
		scope: { commitHash: firstHash, kind: 'commit' },
		workspaceCwd: dir,
	});
	assert.deepEqual(
		root.files.map((file) => [file.path, file.status]),
		[['a.ts', 'added']],
	);

	// A file diff scoped to the commit shows that commit's own hunk.
	const diff = await service.getFileDiff({
		path: 'a.ts',
		scope: { commitHash: headHash, kind: 'commit' },
		workspaceCwd: dir,
	});
	assert.ok(diff.patch?.includes('+more'));
});

test('getStatus (real git) branch scope spans commits + uncommitted', async (t) => {
	const dir = await mkdtemp(path.join(tmpdir(), 'ensemblr-git-branch-'));
	t.after(() => rm(dir, { force: true, recursive: true }));
	const git = (...args: string[]) => execFileAsync('git', args, { cwd: dir });
	await git('init', '-q');
	await git('config', 'user.email', 'test@example.com');
	await git('config', 'user.name', 'Test');
	await writeFile(path.join(dir, 'base.ts'), 'base\n');
	await git('add', '.');
	await git('commit', '-q', '-m', 'base');
	const baseBranch = (
		await git('rev-parse', '--abbrev-ref', 'HEAD')
	).stdout.trim();

	await git('checkout', '-q', '-b', 'feature');
	await writeFile(path.join(dir, 'feat.ts'), 'feature\n');
	await git('add', '.');
	await git('commit', '-q', '-m', 'feat');
	// Uncommitted tracked edit + a brand-new untracked file.
	await writeFile(path.join(dir, 'base.ts'), 'base edited\n');
	await writeFile(path.join(dir, 'untracked.ts'), 'new\n');

	const service = createWorkspaceGitService({
		localCommandService: realCommandService(),
	});

	const branch = await service.getStatus({
		scope: { baseRef: baseBranch, kind: 'branch' },
		workspaceCwd: dir,
	});
	assert.equal(branch.error, undefined);
	assert.deepEqual(
		branch.files.map((file) => [file.path, file.status]).sort(),
		[
			['base.ts', 'modified'],
			['feat.ts', 'added'],
			['untracked.ts', 'untracked'],
		],
	);

	// An unresolvable base ref degrades to the working-tree (uncommitted) set.
	const fallback = await service.getStatus({
		scope: { baseRef: 'no-such-ref', kind: 'branch' },
		workspaceCwd: dir,
	});
	assert.deepEqual(fallback.files.map((file) => file.path).sort(), [
		'base.ts',
		'untracked.ts',
	]);
});

test('getCommits (real git) scopes to branch commits when given a base ref', async (t) => {
	const dir = await mkdtemp(path.join(tmpdir(), 'ensemblr-git-log-'));
	t.after(() => rm(dir, { force: true, recursive: true }));
	const git = (...args: string[]) => execFileAsync('git', args, { cwd: dir });
	await git('init', '-q');
	await git('config', 'user.email', 'test@example.com');
	await git('config', 'user.name', 'Test');
	await writeFile(path.join(dir, 'base.ts'), 'base\n');
	await git('add', '.');
	await git('commit', '-q', '-m', 'initial');
	const baseBranch = (
		await git('rev-parse', '--abbrev-ref', 'HEAD')
	).stdout.trim();

	await git('checkout', '-q', '-b', 'feature');
	await writeFile(path.join(dir, 'a.ts'), 'a\n');
	await git('add', '.');
	await git('commit', '-q', '-m', 'feat one');
	await writeFile(path.join(dir, 'b.ts'), 'b\n');
	await git('add', '.');
	await git('commit', '-q', '-m', 'feat two');

	const service = createWorkspaceGitService({
		localCommandService: realCommandService(),
	});

	// Scoped to the branch: only the two feature commits, not the base/initial.
	const scoped = await service.getCommits({
		baseRef: baseBranch,
		workspaceCwd: dir,
	});
	assert.deepEqual(
		scoped.commits.map((commit) => commit.subject),
		['feat two', 'feat one'],
	);

	// Without a base ref, the whole history (including initial) is returned.
	const all = await service.getCommits({ workspaceCwd: dir });
	assert.deepEqual(
		all.commits.map((commit) => commit.subject),
		['feat two', 'feat one', 'initial'],
	);
});
