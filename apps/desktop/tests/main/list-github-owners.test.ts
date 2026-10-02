import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	LocalCommandRequest,
	LocalCommandResult,
	LocalCommandService,
} from '../../src/main/commands/local-command';
import { createGithubOwnerListService } from '../../src/main/repository/list-github-owners.ts';

const fixedNow = () => new Date('2026-06-07T12:00:00.000Z');

function commandSuccess(
	request: LocalCommandRequest,
	stdout: string,
): LocalCommandResult {
	return {
		args: Array.from(request.args ?? []),
		command: request.command,
		cwd: request.cwd ?? '',
		durationMs: 0,
		endedAt: fixedNow().toISOString(),
		environment: null,
		exitCode: 0,
		logs: {
			command: request.command,
			cwd: request.cwd ?? '',
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

function commandFailure(
	request: LocalCommandRequest,
	failureCode: 'command-not-found' | 'nonzero-exit',
	stderr: string,
): LocalCommandResult {
	return {
		args: Array.from(request.args ?? []),
		command: request.command,
		cwd: request.cwd ?? '',
		durationMs: 0,
		endedAt: fixedNow().toISOString(),
		environment: null,
		exitCode: failureCode === 'nonzero-exit' ? 1 : null,
		failure: {
			code: failureCode,
			exitCode: failureCode === 'nonzero-exit' ? 1 : null,
			message: failureCode,
			signal: null,
		},
		logs: {
			command: request.command,
			cwd: request.cwd ?? '',
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

function isGraphqlCall(request: LocalCommandRequest): boolean {
	return Array.from(request.args ?? []).includes('graphql');
}

function commandServiceStub({
	calls,
	onRun,
}: {
	calls: LocalCommandRequest[];
	onRun: (request: LocalCommandRequest) => LocalCommandResult;
}): LocalCommandService {
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
			calls.push(request);
			return onRun(request);
		},
	};
}

const MEMBERSHIPS = JSON.stringify([
	{ avatar_url: 'https://avatars/boundary', login: 'boundary-digital' },
	{ avatar_url: 'https://avatars/set', login: 'the-set-set' },
	{ avatar_url: 'https://avatars/ensemblr', login: 'ensemblr-hq' },
	{ avatar_url: 'https://avatars/restricted', login: 'locked-org' },
]);

const VIEWER = JSON.stringify({
	data: {
		viewer: {
			avatarUrl: 'https://avatars/psoldunov',
			login: 'psoldunov',
			organizations: {
				nodes: [
					{
						avatarUrl: 'https://avatars/ensemblr',
						login: 'ensemblr-hq',
						name: 'Ensemblr',
						viewerCanCreateRepositories: true,
					},
					{
						avatarUrl: 'https://avatars/boundary',
						login: 'boundary-digital',
						name: 'Almost Always',
						viewerCanCreateRepositories: true,
					},
					{
						avatarUrl: 'https://avatars/restricted',
						login: 'locked-org',
						name: 'Locked',
						viewerCanCreateRepositories: false,
					},
				],
			},
		},
	},
});

function serviceWith(
	onRun: (request: LocalCommandRequest) => LocalCommandResult,
	calls: LocalCommandRequest[] = [],
) {
	return createGithubOwnerListService({
		localCommandService: commandServiceStub({ calls, onRun }),
		now: fixedNow,
	});
}

test('list puts the viewer first, then creatable orgs, then blocked ones', async () => {
	const calls: LocalCommandRequest[] = [];
	const service = serviceWith(
		(request) =>
			commandSuccess(request, isGraphqlCall(request) ? VIEWER : MEMBERSHIPS),
		calls,
	);

	const result = await service.list();

	assert.equal(result.status, 'success');
	assert.deepEqual(
		result.owners.map((owner) => owner.login),
		[
			'psoldunov',
			'boundary-digital',
			'ensemblr-hq',
			'locked-org',
			'the-set-set',
		],
	);
	assert.equal(result.owners[0]?.kind, 'user');
	assert.equal(result.owners[0]?.canCreate, true);
	assert.equal(result.owners[0]?.avatarUrl, 'https://avatars/psoldunov');
	assert.equal(result.owners[2]?.displayName, 'Ensemblr');
	assert.equal(calls.length, 2);
});

test('list marks an org that reserves creation for its owners', async () => {
	const service = serviceWith((request) =>
		commandSuccess(request, isGraphqlCall(request) ? VIEWER : MEMBERSHIPS),
	);

	const result = await service.list();
	const locked = result.owners.find((owner) => owner.login === 'locked-org');

	assert.equal(locked?.canCreate, false);
	assert.equal(locked?.restriction?.code, 'owner-create-restricted');
	assert.match(locked?.restriction?.message ?? '', /locked-org/);
});

test('list marks an org GraphQL cannot see as access restricted', async () => {
	const service = serviceWith((request) =>
		commandSuccess(request, isGraphqlCall(request) ? VIEWER : MEMBERSHIPS),
	);

	const result = await service.list();
	const concealed = result.owners.find(
		(owner) => owner.login === 'the-set-set',
	);

	assert.equal(concealed?.canCreate, false);
	assert.equal(concealed?.restriction?.code, 'owner-access-restricted');
	assert.equal(concealed?.avatarUrl, 'https://avatars/set');
});

test('list returns only the viewer when the user belongs to no orgs', async () => {
	const service = serviceWith((request) =>
		commandSuccess(request, isGraphqlCall(request) ? VIEWER : '[]'),
	);

	const result = await service.list();

	assert.equal(result.status, 'success');
	assert.deepEqual(
		result.owners.map((owner) => owner.login),
		['psoldunov'],
	);
});

test('list fails when gh is missing', async () => {
	const calls: LocalCommandRequest[] = [];
	const service = serviceWith(
		(request) => commandFailure(request, 'command-not-found', 'no gh'),
		calls,
	);

	const result = await service.list();

	assert.equal(result.status, 'failure');
	assert.deepEqual(result.owners, []);
	assert.equal(typeof result.error, 'string');
});

test('list starts both gh calls without waiting for the first to answer', async () => {
	const calls: LocalCommandRequest[] = [];
	const service = createGithubOwnerListService({
		localCommandService: {
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
				await new Promise((resolve) => {
					setTimeout(resolve, 10);
				});
				return commandSuccess(
					request,
					isGraphqlCall(request) ? VIEWER : MEMBERSHIPS,
				);
			},
		},
		now: fixedNow,
	});

	const pending = service.list();
	await Promise.resolve();
	assert.equal(calls.length, 2, 'both gh calls should be in flight at once');

	assert.equal((await pending).status, 'success');
});

test('list fails when gh is unauthenticated', async () => {
	const service = serviceWith((request) =>
		isGraphqlCall(request)
			? commandFailure(request, 'nonzero-exit', 'gh auth login required')
			: commandSuccess(request, MEMBERSHIPS),
	);

	const result = await service.list();

	assert.equal(result.status, 'failure');
	assert.deepEqual(result.owners, []);
});

test('list fails rather than throwing on malformed gh output', async () => {
	const service = serviceWith((request) =>
		commandSuccess(request, isGraphqlCall(request) ? VIEWER : 'not json'),
	);

	const result = await service.list();

	assert.equal(result.status, 'failure');
	assert.deepEqual(result.owners, []);
});

test('list fails when graphql omits the viewer login', async () => {
	const service = serviceWith((request) =>
		commandSuccess(
			request,
			isGraphqlCall(request)
				? JSON.stringify({ data: { viewer: null } })
				: MEMBERSHIPS,
		),
	);

	const result = await service.list();

	assert.equal(result.status, 'failure');
	assert.deepEqual(result.owners, []);
});
