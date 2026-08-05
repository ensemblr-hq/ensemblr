import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	LocalCommandRequest,
	LocalCommandResult,
	LocalCommandService,
} from '../../src/main/commands/local-command';
import { createSetWorkspaceBaseBranchService } from '../../src/main/repository/set-workspace-base-branch.ts';
import type { EnsemblrDatabaseService } from '../../src/main/storage';

const fixedNow = () => new Date('2026-08-05T12:00:00.000Z');

function buildResult(
	overrides: Partial<LocalCommandResult> & Pick<LocalCommandResult, 'status'>,
): LocalCommandResult {
	return {
		args: [],
		command: 'git',
		cwd: '/repo',
		durationMs: 0,
		endedAt: fixedNow().toISOString(),
		environment: null,
		exitCode: overrides.status === 'success' ? 0 : 1,
		logs: { command: 'git', cwd: '/repo', env: {}, stderr: '', stdout: '' },
		signal: null,
		startedAt: fixedNow().toISOString(),
		stderr: '',
		stderrTruncated: false,
		stdout: '',
		stdoutTruncated: false,
		...overrides,
	};
}

function stubCommandService(
	handler: (request: LocalCommandRequest) => LocalCommandResult,
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
				return handler(request);
			},
		},
	};
}

/** Fake database recording the SQL statements the service runs. */
function fakeDatabaseService(
	workspaceRow: Record<string, unknown> | undefined,
): {
	databaseService: EnsemblrDatabaseService;
	writes: Array<{ params: unknown[]; sql: string }>;
} {
	const writes: Array<{ params: unknown[]; sql: string }> = [];
	const database = {
		prepare: (sql: string) => ({
			get: () => workspaceRow,
			run: (...params: unknown[]) => {
				writes.push({ params, sql });
			},
		}),
	};
	return {
		databaseService: {
			getConnection: () => ({ database }),
		} as unknown as EnsemblrDatabaseService,
		writes,
	};
}

const workspaceRow = {
	baseBranch: 'origin/master',
	id: 'ws-1',
	repositoryPath: '/repo',
};

function isVerify(request: LocalCommandRequest): boolean {
	return request.args?.[0] === 'rev-parse';
}

test('retargets the workspace when the ref already resolves locally', async () => {
	const { calls, service } = stubCommandService(() =>
		buildResult({ status: 'success' }),
	);
	const { databaseService, writes } = fakeDatabaseService(workspaceRow);
	const subject = createSetWorkspaceBaseBranchService({
		databaseService,
		localCommandService: service,
		now: fixedNow,
	});

	const result = await subject.setBaseBranch({
		baseBranch: 'origin/release',
		workspaceId: 'ws-1',
	});

	assert.equal(result.status, 'success');
	assert.equal(result.baseBranch, 'origin/release');
	assert.equal(writes.length, 1);
	assert.match(writes[0]?.sql ?? '', /UPDATE workspaces/);
	assert.deepEqual(writes[0]?.params, [
		'origin/release',
		fixedNow().toISOString(),
		'ws-1',
	]);
	assert.ok(!calls.some((call) => call.args?.[0] === 'fetch'));
});

test('fetches an unfetched remote ref before persisting it', async () => {
	let fetched = false;
	const { calls, service } = stubCommandService((request) => {
		if (request.args?.[0] === 'fetch') {
			fetched = true;
		}
		const resolves = fetched || !isVerify(request);
		return buildResult({ status: resolves ? 'success' : 'failure' });
	});
	const { databaseService, writes } = fakeDatabaseService(workspaceRow);
	const subject = createSetWorkspaceBaseBranchService({
		databaseService,
		localCommandService: service,
		now: fixedNow,
	});

	const result = await subject.setBaseBranch({
		baseBranch: 'origin/never-fetched',
		workspaceId: 'ws-1',
	});

	assert.equal(result.status, 'success');
	assert.deepEqual(calls.find((call) => call.args?.[0] === 'fetch')?.args, [
		'fetch',
		'origin',
		'never-fetched',
	]);
	assert.equal(writes.length, 1);
});

test('leaves the row untouched when the ref stays unresolvable after fetching', async () => {
	const { service } = stubCommandService((request) =>
		buildResult({ status: isVerify(request) ? 'failure' : 'success' }),
	);
	const { databaseService, writes } = fakeDatabaseService(workspaceRow);
	const subject = createSetWorkspaceBaseBranchService({
		databaseService,
		localCommandService: service,
		now: fixedNow,
	});

	const result = await subject.setBaseBranch({
		baseBranch: 'origin/ghost',
		workspaceId: 'ws-1',
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'base-branch-unresolvable');
	assert.equal(writes.length, 0);
});

test('rejects a ref that could smuggle an option into a later git call', async () => {
	const { calls, service } = stubCommandService(() =>
		buildResult({ status: 'success' }),
	);
	const { databaseService, writes } = fakeDatabaseService(workspaceRow);
	const subject = createSetWorkspaceBaseBranchService({
		databaseService,
		localCommandService: service,
		now: fixedNow,
	});

	const result = await subject.setBaseBranch({
		baseBranch: '--upload-pack=touch /tmp/pwned',
		workspaceId: 'ws-1',
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'base-branch-invalid');
	assert.equal(calls.length, 0);
	assert.equal(writes.length, 0);
});

test('rejects an option hidden behind a remote qualifier', async () => {
	const { calls, service } = stubCommandService(() =>
		buildResult({ status: 'success' }),
	);
	const { databaseService, writes } = fakeDatabaseService(workspaceRow);
	const subject = createSetWorkspaceBaseBranchService({
		databaseService,
		localCommandService: service,
		now: fixedNow,
	});

	// `ensureBaseRefAvailable` splits at the first slash and passes the tail to
	// `git fetch origin <tail>`, where a dash-led segment is read as an option.
	const result = await subject.setBaseBranch({
		baseBranch: 'origin/--upload-pack=/tmp/pwned.sh',
		workspaceId: 'ws-1',
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'base-branch-invalid');
	assert.equal(calls.length, 0);
	assert.equal(writes.length, 0);
});

test('reports a missing workspace without running git', async () => {
	const { calls, service } = stubCommandService(() =>
		buildResult({ status: 'success' }),
	);
	const { databaseService, writes } = fakeDatabaseService(undefined);
	const subject = createSetWorkspaceBaseBranchService({
		databaseService,
		localCommandService: service,
		now: fixedNow,
	});

	const result = await subject.setBaseBranch({
		baseBranch: 'origin/master',
		workspaceId: 'gone',
	});

	assert.equal(result.status, 'failure');
	assert.equal(result.diagnostics[0]?.code, 'workspace-not-found');
	assert.equal(calls.length, 0);
	assert.equal(writes.length, 0);
});

test('skips the write when the workspace already targets that branch', async () => {
	const { calls, service } = stubCommandService(() =>
		buildResult({ status: 'success' }),
	);
	const { databaseService, writes } = fakeDatabaseService(workspaceRow);
	const subject = createSetWorkspaceBaseBranchService({
		databaseService,
		localCommandService: service,
		now: fixedNow,
	});

	const result = await subject.setBaseBranch({
		baseBranch: 'origin/master',
		workspaceId: 'ws-1',
	});

	assert.equal(result.status, 'success');
	assert.equal(calls.length, 0);
	assert.equal(writes.length, 0);
});
