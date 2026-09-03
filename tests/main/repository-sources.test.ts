import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	LocalCommandRequest,
	LocalCommandResult,
	LocalCommandService,
} from '../../src/main/commands/local-command';
import { parseBranches } from '../../src/main/repository/github-branches.ts';
import {
	createRepositorySourcesService,
	parseIssues,
	parsePullRequests,
} from '../../src/main/repository/repository-sources-service.ts';
import type { EnsemblrDatabaseService } from '../../src/main/storage';

const fixedNow = () => new Date('2026-06-07T12:00:00.000Z');

function buildResult(
	command: 'gh' | 'git',
	overrides: Partial<LocalCommandResult> & Pick<LocalCommandResult, 'status'>,
): LocalCommandResult {
	return {
		args: [],
		command,
		cwd: '/repo',
		durationMs: 0,
		endedAt: fixedNow().toISOString(),
		environment: null,
		exitCode: overrides.status === 'success' ? 0 : 1,
		logs: { command, cwd: '/repo', env: {}, stderr: '', stdout: '' },
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

/** Fake database returning the active workspace-branch rows for the picker. */
function fakeDatabaseService(
	activeRows: Array<{ branchName: string; id: string }>,
): EnsemblrDatabaseService {
	const database = {
		prepare: () => ({
			all: () => activeRows,
			get: () => ({ path: '/repo' }),
			run: () => undefined,
		}),
	};
	return {
		getConnection: () => ({ database }),
	} as unknown as EnsemblrDatabaseService;
}

/** One cached issue row, enough to satisfy the cache's element guard. */
const CACHED_ISSUE = {
	assigneeLogins: [],
	authorLogin: 'octocat',
	body: '',
	labels: [],
	number: 7,
	state: 'OPEN',
	title: 'Cached',
	updatedAt: '2020-01-01T00:00:00Z',
	url: 'https://github.com/o/r/issues/7',
};

/**
 * A database whose `integration_metadata` read answers with a cached issue list,
 * so the degradable branches of `listIssues` can be exercised.
 */
function fakeDatabaseServiceWithCache(cached: {
	issues: unknown[];
	syncedAt: string;
}): EnsemblrDatabaseService {
	const database = {
		prepare: (sql: string) => ({
			all: () => [],
			get: () =>
				sql.includes('integration_metadata')
					? { metadata_json: JSON.stringify(cached) }
					: { path: '/repo' },
			run: () => undefined,
		}),
	};
	return {
		getConnection: () => ({ database }),
	} as unknown as EnsemblrDatabaseService;
}

test('parseBranches reads the default branch and sorts names newest-commit-first', () => {
	const stdout = JSON.stringify({
		data: {
			repository: {
				defaultBranchRef: { name: 'master' },
				refs: {
					nodes: [
						{
							name: 'octocat/fix-y',
							target: { committedDate: '2026-06-10T00:00:00Z' },
						},
						{
							name: 'master',
							target: { committedDate: '2026-06-01T00:00:00Z' },
						},
						{
							name: 'octocat/feature-x',
							target: { committedDate: '2026-06-20T00:00:00Z' },
						},
					],
				},
			},
		},
	});

	const parsed = parseBranches(stdout);

	assert.equal(parsed?.defaultBranch, 'master');
	assert.deepEqual(parsed?.names, [
		'octocat/feature-x',
		'octocat/fix-y',
		'master',
	]);
});

test('parseBranches returns null for non-JSON', () => {
	assert.equal(parseBranches('<html>'), null);
});

test('parsePullRequests maps gh JSON and tolerates missing author', () => {
	const stdout = JSON.stringify([
		{
			author: { login: 'octocat' },
			baseRefName: 'master',
			headRefName: 'feature-x',
			isDraft: false,
			number: 30,
			state: 'OPEN',
			title: 'Add the picker',
			updatedAt: '2026-06-06T17:30:00.000Z',
			url: 'https://github.com/o/r/pull/30',
		},
		{
			author: null,
			headRefName: 'fix-y',
			isCrossRepository: true,
			isDraft: true,
			number: 31,
			state: 'OPEN',
			title: 'Fix Y',
			updatedAt: '2026-06-05T10:00:00.000Z',
			url: 'https://github.com/o/r/pull/31',
		},
	]);

	const rows = parsePullRequests(stdout);

	assert.equal(rows?.length, 2);
	assert.equal(rows?.[0]?.authorLogin, 'octocat');
	assert.equal(rows?.[0]?.headRefName, 'feature-x');
	assert.equal(rows?.[0]?.baseRefName, 'master');
	assert.equal(rows?.[0]?.isCrossRepository, false);
	assert.equal(rows?.[1]?.authorLogin, null);
	assert.equal(rows?.[1]?.isDraft, true);
	assert.equal(rows?.[1]?.isCrossRepository, true);
	// A PR listing without baseRefName degrades to an empty target rather than
	// dropping the row; the seed then leaves the base to the creation service.
	assert.equal(rows?.[1]?.baseRefName, '');
});

test('parsePullRequests returns null for non-JSON', () => {
	assert.equal(parsePullRequests('<html>'), null);
});

test('parseIssues flattens label names and tolerates missing labels', () => {
	const stdout = JSON.stringify([
		{
			assignees: [{ login: 'octocat' }],
			author: { login: 'octocat' },
			body: 'Repro: open the picker.',
			labels: [{ name: 'bug' }, { name: 'p1' }],
			number: 44,
			state: 'OPEN',
			title: 'Dedup recents',
			updatedAt: '2026-06-06T17:30:00.000Z',
			url: 'https://github.com/o/r/issues/44',
		},
		{ number: 41, title: 'No labels' },
	]);

	const rows = parseIssues(stdout);

	assert.deepEqual(rows?.[0]?.labels, ['bug', 'p1']);
	assert.deepEqual(rows?.[0]?.assigneeLogins, ['octocat']);
	assert.equal(rows?.[0]?.body, 'Repro: open the picker.');
	assert.deepEqual(rows?.[1]?.labels, []);
	assert.deepEqual(rows?.[1]?.assigneeLogins, []);
	assert.equal(rows?.[1]?.body, '');
	assert.equal(rows?.[1]?.number, 41);
});

test('listBranches pins the default branch first and marks hasWorkspace', async () => {
	const stdout = JSON.stringify({
		data: {
			repository: {
				defaultBranchRef: { name: 'master' },
				refs: {
					nodes: [
						{
							name: 'octocat/feature-x',
							target: { committedDate: '2026-06-20T00:00:00Z' },
						},
						{
							name: 'master',
							target: { committedDate: '2026-06-01T00:00:00Z' },
						},
						{
							name: 'octocat/fix-y',
							target: { committedDate: '2026-06-10T00:00:00Z' },
						},
					],
				},
			},
		},
	});
	const { calls, service: commandService } = stubCommandService(() =>
		buildResult('gh', { status: 'success', stdout }),
	);
	const service = createRepositorySourcesService({
		databaseService: fakeDatabaseService([
			{ branchName: 'octocat/feature-x', id: 'ws-1' },
		]),
		localCommandService: commandService,
		resolveRepositoryPath: () => '/repo',
	});

	const result = await service.listBranches({ repositoryId: 'repo-1' });

	assert.equal(result.status, 'ok');
	// Default branch is always topmost; the rest keep GitHub's order.
	assert.deepEqual(
		result.branches.map((b) => b.name),
		['master', 'octocat/feature-x', 'octocat/fix-y'],
	);
	assert.equal(result.branches[0]?.isDefault, true);
	const featureX = result.branches.find((b) => b.name === 'octocat/feature-x');
	assert.equal(featureX?.hasWorkspace, true);
	assert.equal(featureX?.workspaceId, 'ws-1');
	// Sourced live from GitHub via gh GraphQL, not local refs.
	assert.equal(calls[0]?.command, 'gh');
	assert.deepEqual(calls[0]?.args?.slice(0, 2), ['api', 'graphql']);
	// The checkout leg leans on gh's placeholders, which only expand under `-F`.
	assert.equal(calls[0]?.cwd, '/repo');
	assert.deepEqual(calls[0]?.args?.slice(2, 6), [
		'-F',
		'owner={owner}',
		'-F',
		'name={repo}',
	]);
});

test('listPullRequests calls gh in the repo path and maps rows', async () => {
	const stdout = JSON.stringify([
		{
			author: { login: 'octocat' },
			headRefName: 'feature-x',
			isDraft: false,
			number: 30,
			state: 'OPEN',
			title: 'Add the picker',
			updatedAt: '2026-06-06T17:30:00.000Z',
			url: 'https://github.com/o/r/pull/30',
		},
	]);
	const { calls, service: commandService } = stubCommandService(() =>
		buildResult('gh', { status: 'success', stdout }),
	);
	const service = createRepositorySourcesService({
		databaseService: fakeDatabaseService([]),
		localCommandService: commandService,
		resolveRepositoryPath: () => '/repo',
	});

	const result = await service.listPullRequests({ repositoryId: 'repo-1' });

	assert.equal(result.status, 'ok');
	assert.equal(result.pullRequests.length, 1);
	assert.equal(calls[0]?.command, 'gh');
	assert.equal(calls[0]?.cwd, '/repo');
	assert.deepEqual(calls[0]?.args?.slice(0, 2), ['pr', 'list']);
	// The workspace targets the PR's base, so the base ref must be requested.
	assert.ok(calls[0]?.args?.some((arg) => arg.includes('baseRefName')));
});

test('listPullRequests marks a head branch an active workspace already holds', async () => {
	const stdout = JSON.stringify([
		{
			author: { login: 'octocat' },
			baseRefName: 'master',
			headRefName: 'feature-x',
			isCrossRepository: false,
			isDraft: false,
			number: 30,
			state: 'OPEN',
			title: 'Add the picker',
			updatedAt: '2026-06-06T17:30:00.000Z',
			url: 'https://github.com/o/r/pull/30',
		},
	]);
	const { service: commandService } = stubCommandService(() =>
		buildResult('gh', { status: 'success', stdout }),
	);
	const service = createRepositorySourcesService({
		databaseService: fakeDatabaseService([
			{ branchName: 'feature-x', id: 'ws-1' },
		]),
		localCommandService: commandService,
		resolveRepositoryPath: () => '/repo',
	});

	const result = await service.listPullRequests({ repositoryId: 'repo-1' });

	assert.equal(result.pullRequests[0]?.hasWorkspace, true);
	assert.equal(result.pullRequests[0]?.workspaceId, 'ws-1');
});

test('listPullRequests drops cross-repository (fork) PRs', async () => {
	const stdout = JSON.stringify([
		{
			author: { login: 'octocat' },
			headRefName: 'feature-x',
			isCrossRepository: false,
			isDraft: false,
			number: 30,
			state: 'OPEN',
			title: 'Same-repo PR',
			updatedAt: '2026-06-06T17:30:00.000Z',
			url: 'https://github.com/o/r/pull/30',
		},
		{
			author: { login: 'contributor' },
			headRefName: 'patch-1',
			isCrossRepository: true,
			isDraft: false,
			number: 31,
			state: 'OPEN',
			title: 'Fork PR',
			updatedAt: '2026-06-05T10:00:00.000Z',
			url: 'https://github.com/o/r/pull/31',
		},
	]);
	const { service: commandService } = stubCommandService(() =>
		buildResult('gh', { status: 'success', stdout }),
	);
	const service = createRepositorySourcesService({
		databaseService: fakeDatabaseService([]),
		localCommandService: commandService,
		resolveRepositoryPath: () => '/repo',
	});

	const result = await service.listPullRequests({ repositoryId: 'repo-1' });

	assert.equal(result.status, 'ok');
	// Only the same-repo PR survives; the fork PR cannot fork off origin.
	assert.deepEqual(
		result.pullRequests.map((pullRequest) => pullRequest.number),
		[30],
	);
});

test('listIssues degrades to a typed error when gh fails', async () => {
	const { service: commandService } = stubCommandService(() =>
		buildResult('gh', {
			failure: {
				code: 'nonzero-exit',
				exitCode: 1,
				message: 'auth',
				signal: null,
			},
			status: 'failure',
			stderr: 'gh: authentication required; run gh auth login',
		}),
	);
	const service = createRepositorySourcesService({
		databaseService: fakeDatabaseService([]),
		localCommandService: commandService,
		resolveRepositoryPath: () => '/repo',
	});

	const result = await service.listIssues({ repositoryId: 'repo-1' });

	assert.equal(result.status, 'error');
	assert.equal(result.issues.length, 0);
	assert.equal(
		result.status === 'error' && result.error.code,
		'gh-not-authenticated',
	);
});

// A cached list standing in for a failed refresh is still `ok` — the rows are
// real, just old — but dropping the failure makes stale issues indistinguishable
// from current ones, and both consumers read only `status`.
test('listIssues serves the cache with staleError when gh fails', async () => {
	const { service: commandService } = stubCommandService(() =>
		buildResult('gh', {
			failure: {
				code: 'nonzero-exit',
				exitCode: 1,
				message: 'auth',
				signal: null,
			},
			status: 'failure',
			stderr: 'gh: authentication required; run gh auth login',
		}),
	);
	const service = createRepositorySourcesService({
		databaseService: fakeDatabaseServiceWithCache({
			issues: [CACHED_ISSUE],
			syncedAt: '2020-01-01T00:00:00.000Z',
		}),
		localCommandService: commandService,
		resolveRepositoryPath: () => '/repo',
	});

	const result = await service.listIssues({
		refresh: true,
		repositoryId: 'repo-1',
	});

	assert.equal(result.status, 'ok');
	assert.equal(result.status === 'ok' && result.source, 'cache');
	assert.equal(result.issues.length, 1);
	assert.equal(
		result.status === 'ok' && result.staleError?.code,
		'gh-not-authenticated',
	);
	assert.equal(
		result.status === 'ok' && result.syncedAt,
		'2020-01-01T00:00:00.000Z',
	);
});

test('listIssues serves a fresh cache without a staleError', async () => {
	const { calls, service: commandService } = stubCommandService(() =>
		buildResult('gh', { status: 'success', stdout: '[]' }),
	);
	const service = createRepositorySourcesService({
		databaseService: fakeDatabaseServiceWithCache({
			issues: [CACHED_ISSUE],
			syncedAt: new Date().toISOString(),
		}),
		localCommandService: commandService,
		resolveRepositoryPath: () => '/repo',
	});

	const result = await service.listIssues({ repositoryId: 'repo-1' });

	assert.equal(result.status, 'ok');
	assert.equal(result.status === 'ok' && result.staleError, undefined);
	// A fresh cache answers without shelling out at all.
	assert.equal(calls.length, 0);
});

test('listIssues asks gh for unassigned issues only when the board asks', async () => {
	const { calls, service: commandService } = stubCommandService(() =>
		buildResult('gh', { status: 'success', stdout: '[]' }),
	);
	const service = createRepositorySourcesService({
		databaseService: fakeDatabaseService([]),
		localCommandService: commandService,
		resolveRepositoryPath: () => '/repo',
	});

	await service.listIssues({ repositoryId: 'repo-1', unassignedOnly: true });
	await service.listIssues({ repositoryId: 'repo-1' });

	assert.deepEqual(calls[0]?.args?.slice(-2), ['--search', 'no:assignee']);
	assert.equal(calls[1]?.args?.includes('--search'), false);
});

// `gh issue list` exits 1 on a repository whose issues are turned off, but the
// dashboard board fans this call out across every repository at once — one such
// repository must not redden the whole Backlog column with an unactionable
// "The command failed."
test('listIssues answers with an empty list when the repository has issues disabled', async () => {
	const { service: commandService } = stubCommandService(() =>
		buildResult('gh', {
			failure: {
				code: 'nonzero-exit',
				exitCode: 1,
				message: '',
				signal: null,
			},
			status: 'failure',
			stderr: "the 'acme/widgets' repository has disabled issues",
		}),
	);
	const service = createRepositorySourcesService({
		databaseService: fakeDatabaseService([]),
		localCommandService: commandService,
		resolveRepositoryPath: () => '/repo',
	});

	const result = await service.listIssues({
		repositoryId: 'repo-1',
		unassignedOnly: true,
	});

	assert.equal(result.status, 'ok');
	assert.equal(result.issues.length, 0);
	assert.equal(result.status === 'ok' && result.staleError, undefined);
	assert.equal(result.status === 'ok' && result.source, 'remote');
});

test('listBranches reports an error when the repository is unknown', async () => {
	const { service: commandService } = stubCommandService(() =>
		buildResult('git', { status: 'success', stdout: '' }),
	);
	const service = createRepositorySourcesService({
		databaseService: fakeDatabaseService([]),
		localCommandService: commandService,
		resolveRepositoryPath: () => null,
	});

	const result = await service.listBranches({ repositoryId: 'missing' });

	assert.equal(result.status, 'error');
	assert.equal(result.branches.length, 0);
});
