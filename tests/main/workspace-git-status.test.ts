import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type {
	LocalCommandRequest,
	LocalCommandResult,
	LocalCommandService,
} from '../../src/main/commands/local-command';
import {
	createWorkspaceGitService,
	parseNumstat,
	parsePorcelainStatus,
} from '../../src/main/workspace-git/workspace-git-status.ts';

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
	const workspaceDir = await mkdtemp(path.join(tmpdir(), 'ensemble-git-'));
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
