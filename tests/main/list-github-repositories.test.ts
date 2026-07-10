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

function stubCommandServiceSequence(results: LocalCommandResult[]): {
	calls: LocalCommandRequest[];
	service: LocalCommandService;
} {
	const calls: LocalCommandRequest[] = [];
	let callIndex = 0;
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
				const result = results[callIndex];
				callIndex += 1;
				if (!result) {
					throw new Error('stubCommandServiceSequence: no result configured');
				}
				return result;
			},
		},
	};
}

/** Builds a `gh api --jq ...`-shaped page of `count` distinct repos. */
function buildRepoPage(count: number, startIndex: number): string {
	return JSON.stringify(
		Array.from({ length: count }, (_, index) =>
			buildRepoRaw(`octo/repo-${startIndex + index}`),
		),
	);
}

function buildRepoRaw(fullName: string): Record<string, unknown> {
	return {
		description: `Description for ${fullName}`,
		full_name: fullName,
		owner: {
			avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
			login: 'octo',
		},
		private: false,
		updated_at: '2026-06-06T17:30:00.000Z',
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
			description: 'A repository for ensemblr',
			full_name: 'psoldunov/ensemblr',
			owner: {
				avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
				login: 'psoldunov',
			},
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
	assert.equal(result.entries[0]?.fullName, 'psoldunov/ensemblr');
	assert.equal(result.entries[0]?.isPrivate, false);
	assert.equal(
		result.entries[0]?.avatarUrl,
		'https://avatars.githubusercontent.com/u/1?v=4',
	);
	assert.equal(result.entries[1]?.fullName, 'the-set-set/website');
	assert.equal(result.entries[1]?.isPrivate, true);
	assert.equal(result.entries[1]?.avatarUrl, null);
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

const GH_REPO_FIELDS_JQ =
	'map({description, full_name, private, updated_at, owner: {avatar_url: .owner.avatar_url, login: .owner.login}})';

test('list with scope "full" concatenates pages and stops once a page is short', async () => {
	const { calls, service: commandService } = stubCommandServiceSequence([
		buildSuccess(buildRepoPage(100, 0)),
		buildSuccess(buildRepoPage(30, 100)),
	]);
	const service = createGithubRepositoryListService({
		localCommandService: commandService,
		now: fixedNow,
	});

	const result = await service.list({ scope: 'full' });

	assert.equal(result.status, 'success');
	assert.equal(result.entries.length, 130);
	assert.equal(calls.length, 2);
	assert.deepEqual(calls[0]?.args, [
		'api',
		'--paginate=false',
		'user/repos?sort=updated&per_page=100&page=1&affiliation=owner,collaborator,organization_member',
		'--jq',
		GH_REPO_FIELDS_JQ,
	]);
	assert.deepEqual(calls[1]?.args, [
		'api',
		'--paginate=false',
		'user/repos?sort=updated&per_page=100&page=2&affiliation=owner,collaborator,organization_member',
		'--jq',
		GH_REPO_FIELDS_JQ,
	]);
});

test('list with scope "full" stops at the 5-page cap even when every page is full', async () => {
	const pages = Array.from({ length: 5 }, (_, index) =>
		buildSuccess(buildRepoPage(100, index * 100)),
	);
	const { calls, service: commandService } = stubCommandServiceSequence(pages);
	const service = createGithubRepositoryListService({
		localCommandService: commandService,
		now: fixedNow,
	});

	const result = await service.list({ scope: 'full' });

	assert.equal(result.status, 'success');
	assert.equal(result.entries.length, 500);
	assert.equal(calls.length, 5);
});

test('list with scope "full" fails the whole result when a later page fails', async () => {
	const { calls, service: commandService } = stubCommandServiceSequence([
		buildSuccess(buildRepoPage(100, 0)),
		buildFailure('timeout'),
	]);
	const service = createGithubRepositoryListService({
		localCommandService: commandService,
		now: fixedNow,
	});

	const result = await service.list({ scope: 'full' });

	assert.equal(result.status, 'failure');
	assert.equal(result.entries.length, 0);
	assert.match(result.error ?? '', /timed out/i);
	assert.equal(calls.length, 2);
});

test('list with scope "full" dedupes repos that appear on more than one page', async () => {
	const page2 = JSON.stringify([
		buildRepoRaw('octo/repo-99'),
		...Array.from({ length: 29 }, (_, index) =>
			buildRepoRaw(`octo/repo-${100 + index}`),
		),
	]);
	const { service: commandService } = stubCommandServiceSequence([
		buildSuccess(buildRepoPage(100, 0)),
		buildSuccess(page2),
	]);
	const service = createGithubRepositoryListService({
		localCommandService: commandService,
		now: fixedNow,
	});

	const result = await service.list({ scope: 'full' });

	assert.equal(result.status, 'success');
	// 100 from page 1 + 29 new from page 2; `repo-99` is deduped.
	assert.equal(result.entries.length, 129);
	const fullNames = result.entries.map((entry) => entry.fullName);
	assert.equal(new Set(fullNames).size, fullNames.length);
});
