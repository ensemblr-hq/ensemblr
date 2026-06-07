import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	LocalCommandRequest,
	LocalCommandResult,
	LocalCommandService,
} from '../../src/main/commands/local-command';
import { createGithubRepositoryListService } from '../../src/main/repository/list-github-repositories.ts';

const fixedNow = () => new Date('2026-06-07T12:00:00.000Z');

function stubCommandService(result: LocalCommandResult): {
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
				return result;
			},
		},
	};
}

function buildSuccess(stdout: string): LocalCommandResult {
	return {
		args: [],
		command: 'gh',
		cwd: '/tmp',
		durationMs: 0,
		endedAt: fixedNow().toISOString(),
		environment: null,
		exitCode: 0,
		logs: {
			command: 'gh',
			cwd: '/tmp',
			env: {},
			stderr: '',
			stdout,
		},
		signal: null,
		startedAt: fixedNow().toISOString(),
		status: 'success',
		stderr: '',
		stderrTruncated: false,
		stdout,
		stdoutTruncated: false,
	};
}

function buildFailure(
	code: 'command-not-found' | 'nonzero-exit' | 'timeout',
	stderr = '',
): LocalCommandResult {
	return {
		args: [],
		command: 'gh',
		cwd: '/tmp',
		durationMs: 0,
		endedAt: fixedNow().toISOString(),
		environment: null,
		exitCode: code === 'nonzero-exit' ? 1 : null,
		failure: {
			code,
			exitCode: code === 'nonzero-exit' ? 1 : null,
			message: code,
			signal: null,
		},
		logs: {
			command: 'gh',
			cwd: '/tmp',
			env: {},
			stderr,
			stdout: '',
		},
		signal: null,
		startedAt: fixedNow().toISOString(),
		status: 'failure',
		stderr,
		stderrTruncated: false,
		stdout: '',
		stdoutTruncated: false,
	};
}

test('list maps gh api JSON into GithubRepositoryEntry rows', async () => {
	const stdout = JSON.stringify([
		{
			description: 'A repository for ensemble',
			full_name: 'psoldunov/ensemble',
			owner: { login: 'psoldunov' },
			private: false,
			updated_at: '2026-06-06T17:30:00.000Z',
		},
		{
			description: null,
			full_name: 'the-set-set/website',
			owner: { login: 'the-set-set' },
			private: true,
			updated_at: '2026-06-05T10:00:00.000Z',
		},
	]);

	const { calls, service: commandService } = stubCommandService(
		buildSuccess(stdout),
	);
	const service = createGithubRepositoryListService({
		localCommandService: commandService,
		now: fixedNow,
	});

	const result = await service.list();

	assert.equal(result.status, 'success');
	assert.equal(result.entries.length, 2);
	assert.equal(result.entries[0]?.fullName, 'psoldunov/ensemble');
	assert.equal(result.entries[0]?.isPrivate, false);
	assert.equal(result.entries[1]?.fullName, 'the-set-set/website');
	assert.equal(result.entries[1]?.isPrivate, true);
	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.command, 'gh');
	assert.deepEqual(calls[0]?.args, [
		'api',
		'--paginate=false',
		'user/repos?sort=updated&per_page=8&affiliation=owner,collaborator,organization_member',
	]);
});

test('list reports a friendly message when gh is missing', async () => {
	const { service: commandService } = stubCommandService(
		buildFailure('command-not-found'),
	);
	const service = createGithubRepositoryListService({
		localCommandService: commandService,
		now: fixedNow,
	});

	const result = await service.list();

	assert.equal(result.status, 'failure');
	assert.equal(result.entries.length, 0);
	assert.match(result.error ?? '', /not installed/i);
});

test('list reports auth failure when gh stderr mentions authentication', async () => {
	const { service: commandService } = stubCommandService(
		buildFailure(
			'nonzero-exit',
			'gh: authentication failed; run `gh auth login`\n',
		),
	);
	const service = createGithubRepositoryListService({
		localCommandService: commandService,
		now: fixedNow,
	});

	const result = await service.list();

	assert.equal(result.status, 'failure');
	assert.match(result.error ?? '', /gh auth login/i);
});

test('list surfaces an error when stdout is not JSON', async () => {
	const { service: commandService } = stubCommandService(
		buildSuccess('<html>nope</html>'),
	);
	const service = createGithubRepositoryListService({
		localCommandService: commandService,
		now: fixedNow,
	});

	const result = await service.list();

	assert.equal(result.status, 'failure');
	assert.equal(result.entries.length, 0);
});
