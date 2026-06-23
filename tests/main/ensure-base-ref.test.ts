import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	LocalCommandRequest,
	LocalCommandResult,
	LocalCommandService,
} from '../../src/main/commands/local-command';
import { ensureBaseRefAvailable } from '../../src/main/repository/create-workspace.ts';

const fixedNow = () => new Date('2026-06-07T12:00:00.000Z');

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

/**
 * Stub command service where `git rev-parse` reports the ref present or missing
 * and `git fetch` always succeeds. Captures every request so a test can assert
 * which commands ran.
 */
function stubCommandService(refPresent: boolean): {
	calls: LocalCommandRequest[];
	service: LocalCommandService;
} {
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
				if (request.args?.[0] === 'rev-parse') {
					return buildResult({ status: refPresent ? 'success' : 'failure' });
				}
				return buildResult({ status: 'success' });
			},
		},
	};
}

test('skips the fetch when the base ref already resolves', async () => {
	const { calls, service } = stubCommandService(true);

	await ensureBaseRefAvailable({
		baseBranch: 'origin/feature-x',
		localCommandService: service,
		repositoryPath: '/repo',
	});

	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.args?.[0], 'rev-parse');
});

test('fetches origin/<branch> when the ref is missing', async () => {
	const { calls, service } = stubCommandService(false);

	await ensureBaseRefAvailable({
		baseBranch: 'origin/feature-x',
		localCommandService: service,
		repositoryPath: '/repo',
	});

	assert.equal(calls.length, 2);
	assert.deepEqual(calls[1]?.args, ['fetch', 'origin', 'feature-x']);
});

test('splits only on the first slash so nested branch names survive', async () => {
	const { calls, service } = stubCommandService(false);

	await ensureBaseRefAvailable({
		baseBranch: 'origin/feat/nested/x',
		localCommandService: service,
		repositoryPath: '/repo',
	});

	assert.deepEqual(calls[1]?.args, ['fetch', 'origin', 'feat/nested/x']);
});

test('does not fetch a slashless ref (a local branch name)', async () => {
	const { calls, service } = stubCommandService(false);

	await ensureBaseRefAvailable({
		baseBranch: 'master',
		localCommandService: service,
		repositoryPath: '/repo',
	});

	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.args?.[0], 'rev-parse');
});

test('swallows a thrown command failure instead of propagating it', async () => {
	const calls: LocalCommandRequest[] = [];
	const service: LocalCommandService = {
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
			throw new Error('git exploded');
		},
	};

	await assert.doesNotReject(
		ensureBaseRefAvailable({
			baseBranch: 'origin/feature-x',
			localCommandService: service,
			repositoryPath: '/repo',
		}),
	);
	assert.equal(calls.length, 1);
});
