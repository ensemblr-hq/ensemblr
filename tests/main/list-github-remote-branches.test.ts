import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	LocalCommandRequest,
	LocalCommandResult,
	LocalCommandService,
} from '../../src/main/commands/local-command';
import { createGithubRemoteBranchListService } from '../../src/main/repository/list-github-remote-branches.ts';

const fixedNow = () => new Date('2026-06-07T12:00:00.000Z');

function buildResult(
	overrides: Partial<LocalCommandResult> & Pick<LocalCommandResult, 'status'>,
): LocalCommandResult {
	return {
		args: [],
		command: 'gh',
		cwd: '/',
		durationMs: 0,
		endedAt: fixedNow().toISOString(),
		environment: null,
		exitCode: overrides.status === 'success' ? 0 : 1,
		logs: { command: 'gh', cwd: '/', env: {}, stderr: '', stdout: '' },
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

const BRANCHES_STDOUT = JSON.stringify({
	data: {
		repository: {
			defaultBranchRef: { name: 'main' },
			refs: {
				nodes: [
					{
						name: 'feature-a',
						target: { committedDate: '2026-06-01T00:00:00Z' },
					},
					{ name: 'main', target: { committedDate: '2026-05-01T00:00:00Z' } },
					{
						name: 'feature-b',
						target: { committedDate: '2026-06-05T00:00:00Z' },
					},
				],
			},
		},
	},
});

test('list resolves owner and name from the URL and pins the default branch', async () => {
	const stub = stubCommandService(() =>
		buildResult({ status: 'success', stdout: BRANCHES_STDOUT }),
	);
	const service = createGithubRemoteBranchListService({
		localCommandService: stub.service,
	});

	const result = await service.list({
		url: 'https://github.com/ensemblr-hq/ensemblr.git',
	});

	assert.equal(result.status, 'ok');
	assert.deepEqual(
		result.branches.map((branch) => branch.name),
		['main', 'feature-b', 'feature-a'],
	);
	assert.equal(result.branches[0]?.isDefault, true);
	// Nothing is cloned yet, so no branch can be held by a workspace.
	assert.ok(result.branches.every((branch) => !branch.hasWorkspace));
	assert.ok(result.branches.every((branch) => branch.workspaceId === null));

	const request = stub.calls[0];
	assert.equal(request?.command, 'gh');
	assert.equal(request?.cwd, undefined);
	const args = request?.args ?? [];
	assert.ok(args.includes('owner=ensemblr-hq'));
	assert.ok(args.includes('name=ensemblr'));
});

// `-F` converts an integer-looking value to a JSON number, which GraphQL then
// rejects against `String!` — so a repository named `2048` needs `-f`.
test('list sends literal coordinates as raw fields so a numeric name survives', async () => {
	const stub = stubCommandService(() =>
		buildResult({ status: 'success', stdout: BRANCHES_STDOUT }),
	);
	const service = createGithubRemoteBranchListService({
		localCommandService: stub.service,
	});

	const result = await service.list({
		url: 'https://github.com/gabrielecirulli/2048',
	});

	assert.equal(result.status, 'ok');
	assert.deepEqual(stub.calls[0]?.args?.slice(2, 6), [
		'-f',
		'owner=gabrielecirulli',
		'-f',
		'name=2048',
	]);
});

test('list rejects a URL that is not a GitHub repository without running gh', async () => {
	const stub = stubCommandService(() => buildResult({ status: 'success' }));
	const service = createGithubRemoteBranchListService({
		localCommandService: stub.service,
	});

	const result = await service.list({ url: 'not a url' });

	assert.equal(result.status, 'error');
	assert.deepEqual(result.branches, []);
	assert.equal(stub.calls.length, 0);
	assert.equal(
		result.status === 'error' ? result.error.code : null,
		'url-invalid',
	);
});

test('list asks for a URL rather than blaming a command when none was given', async () => {
	const stub = stubCommandService(() => buildResult({ status: 'success' }));
	const service = createGithubRemoteBranchListService({
		localCommandService: stub.service,
	});

	const result = await service.list({ url: '   ' });

	assert.equal(result.status, 'error');
	assert.equal(stub.calls.length, 0);
	assert.equal(
		result.status === 'error' ? result.error.code : null,
		'url-required',
	);
});

test('list surfaces a typed failure when gh is missing', async () => {
	const stub = stubCommandService(() =>
		buildResult({ status: 'failure', stderr: 'gh: command not found' }),
	);
	const service = createGithubRemoteBranchListService({
		localCommandService: stub.service,
	});

	const result = await service.list({ url: 'ensemblr-hq/ensemblr' });

	assert.equal(result.status, 'error');
	assert.deepEqual(result.branches, []);
	assert.equal(
		result.status === 'error' ? result.error.code : null,
		'gh-not-installed',
	);
});

test('list surfaces a parse failure when gh returns an unusable shape', async () => {
	const stub = stubCommandService(() =>
		buildResult({ status: 'success', stdout: '<html>' }),
	);
	const service = createGithubRemoteBranchListService({
		localCommandService: stub.service,
	});

	const result = await service.list({ url: 'ensemblr-hq/ensemblr' });

	assert.equal(result.status, 'error');
	assert.equal(
		result.status === 'error' ? result.error.code : null,
		'parse-failed',
	);
});
