import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	LocalCommandFailure,
	LocalCommandRequest,
	LocalCommandResult,
	LocalCommandService,
} from '../../src/main/commands/local-command';
import { runWorktreeAdd } from '../../src/main/repository/git-ops.ts';

const fixedNow = () => new Date('2026-06-07T12:00:00.000Z');

/** Builds a command result with sensible defaults for the fields under test. */
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

/** Builds a failure record for a command result. */
function failure(code: LocalCommandFailure['code']): LocalCommandFailure {
	return { code, exitCode: 1, message: code, signal: null };
}

/**
 * Command-service stub that returns a scripted result for each `git worktree
 * add` invocation and always succeeds for the interstitial `git worktree
 * prune`. Records every request so a test can assert the attempt sequence.
 */
function stubService(addResults: LocalCommandResult[]): {
	calls: LocalCommandRequest[];
	service: LocalCommandService;
} {
	const calls: LocalCommandRequest[] = [];
	let addIndex = 0;
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
				if (request.args?.[1] === 'prune') {
					return buildResult({ status: 'success' });
				}
				const result = addResults[addIndex] ?? addResults.at(-1);
				addIndex += 1;
				return result ?? buildResult({ status: 'success' });
			},
		},
	};
}

/** Counts how many `git worktree add` invocations a call log recorded. */
function countAddCalls(calls: LocalCommandRequest[]): number {
	return calls.filter(
		(call) => call.args?.[0] === 'worktree' && call.args?.[1] === 'add',
	).length;
}

test('reports a timeout with an actionable message, not the progress preamble', async () => {
	const { service } = stubService([
		buildResult({
			// A killed-on-timeout `git worktree add` has printed only its progress
			// preamble to stderr before the kill.
			failure: failure('timeout'),
			status: 'failure',
			stderr: "Preparing worktree (new branch 'psoldunov/marianelli')",
		}),
	]);

	const outcome = await runWorktreeAdd({
		baseBranch: 'main',
		branchName: 'psoldunov/marianelli',
		localCommandService: service,
		repositoryPath: '/repo',
		workspacePath: '/repo/ws',
	});

	assert.equal(outcome.status, 'failure');
	assert.match(
		outcome.status === 'failure' ? outcome.message : '',
		/timed out/i,
	);
	assert.doesNotMatch(
		outcome.status === 'failure' ? outcome.message : '',
		/Preparing worktree/,
	);
});

test('surfaces the real fatal line when it follows the progress preamble', async () => {
	const { service } = stubService([
		buildResult({
			failure: failure('nonzero-exit'),
			status: 'failure',
			stderr:
				"Preparing worktree (new branch 'psoldunov/marianelli')\nfatal: invalid reference: refs/heads/psoldunov/marianelli",
		}),
	]);

	const outcome = await runWorktreeAdd({
		baseBranch: 'main',
		branchName: 'psoldunov/marianelli',
		localCommandService: service,
		repositoryPath: '/repo',
		workspacePath: '/repo/ws',
	});

	assert.equal(outcome.status, 'failure');
	assert.equal(
		outcome.status === 'failure' ? outcome.message : '',
		'fatal: invalid reference: refs/heads/psoldunov/marianelli',
	);
});

test('retries a transient lock-contention failure and succeeds', async () => {
	const { calls, service } = stubService([
		buildResult({
			failure: failure('nonzero-exit'),
			status: 'failure',
			stderr:
				"Preparing worktree (new branch 'x')\nfatal: Unable to create '/repo/.git/index.lock': File exists.",
		}),
		buildResult({ status: 'success' }),
	]);

	const outcome = await runWorktreeAdd({
		baseBranch: 'main',
		branchName: 'x',
		localCommandService: service,
		repositoryPath: '/repo',
		workspacePath: '/repo/ws',
	});

	assert.equal(outcome.status, 'success');
	assert.equal(countAddCalls(calls), 2);
});

test('stops after the attempt cap and reports the real lock error', async () => {
	const lockFailure = buildResult({
		failure: failure('nonzero-exit'),
		status: 'failure',
		stderr:
			"Preparing worktree (new branch 'x')\nfatal: Unable to create '/repo/.git/index.lock': File exists.",
	});
	const { calls, service } = stubService([
		lockFailure,
		lockFailure,
		lockFailure,
	]);

	const outcome = await runWorktreeAdd({
		baseBranch: 'main',
		branchName: 'x',
		localCommandService: service,
		repositoryPath: '/repo',
		workspacePath: '/repo/ws',
	});

	assert.equal(outcome.status, 'failure');
	assert.equal(countAddCalls(calls), 3);
	assert.match(
		outcome.status === 'failure' ? outcome.message : '',
		/index\.lock/,
	);
});

test('does not retry a non-transient failure', async () => {
	const { calls, service } = stubService([
		buildResult({
			failure: failure('nonzero-exit'),
			status: 'failure',
			stderr:
				"Preparing worktree (new branch 'x')\nfatal: a branch named 'x' already exists",
		}),
	]);

	const outcome = await runWorktreeAdd({
		baseBranch: 'main',
		branchName: 'x',
		localCommandService: service,
		repositoryPath: '/repo',
		workspacePath: '/repo/ws',
	});

	assert.equal(outcome.status, 'failure');
	assert.equal(countAddCalls(calls), 1);
	assert.match(
		outcome.status === 'failure' ? outcome.message : '',
		/already exists/,
	);
});

test('reports git-missing without retrying', async () => {
	const { calls, service } = stubService([
		buildResult({ failure: failure('command-not-found'), status: 'failure' }),
	]);

	const outcome = await runWorktreeAdd({
		baseBranch: 'main',
		branchName: 'x',
		localCommandService: service,
		repositoryPath: '/repo',
		workspacePath: '/repo/ws',
	});

	assert.equal(outcome.status, 'git-missing');
	assert.equal(countAddCalls(calls), 1);
});
