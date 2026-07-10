import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	LocalCommandRequest,
	LocalCommandResult,
	LocalCommandService,
} from '../../src/main/commands/local-command';
import {
	createRepositorySourcesService,
	parseBranches,
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
							name: 'psoldunov/fix-y',
							target: { committedDate: '2026-06-10T00:00:00Z' },
						},
						{
							name: 'master',
							target: { committedDate: '2026-06-01T00:00:00Z' },
						},
						{
							name: 'psoldunov/feature-x',
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
		'psoldunov/feature-x',
		'psoldunov/fix-y',
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
	assert.equal(rows?.[0]?.isCrossRepository, false);
	assert.equal(rows?.[1]?.authorLogin, null);
	assert.equal(rows?.[1]?.isDraft, true);
	assert.equal(rows?.[1]?.isCrossRepository, true);
});

test('parsePullRequests returns null for non-JSON', () => {
	assert.equal(parsePullRequests('<html>'), null);
});

test('parseIssues flattens label names and tolerates missing labels', () => {
	const stdout = JSON.stringify([
		{
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
	assert.equal(rows?.[0]?.body, 'Repro: open the picker.');
	assert.deepEqual(rows?.[1]?.labels, []);
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
							name: 'psoldunov/feature-x',
							target: { committedDate: '2026-06-20T00:00:00Z' },
						},
						{
							name: 'master',
							target: { committedDate: '2026-06-01T00:00:00Z' },
						},
						{
							name: 'psoldunov/fix-y',
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
			{ branchName: 'psoldunov/feature-x', id: 'ws-1' },
		]),
		localCommandService: commandService,
		resolveRepositoryPath: () => '/repo',
	});

	const result = await service.listBranches({ repositoryId: 'repo-1' });

	assert.equal(result.status, 'ok');
	// Default branch is always topmost; the rest keep GitHub's order.
	assert.deepEqual(
		result.branches.map((b) => b.name),
		['master', 'psoldunov/feature-x', 'psoldunov/fix-y'],
	);
	assert.equal(result.branches[0]?.isDefault, true);
	const featureX = result.branches.find(
		(b) => b.name === 'psoldunov/feature-x',
	);
	assert.equal(featureX?.hasWorkspace, true);
	assert.equal(featureX?.workspaceId, 'ws-1');
	// Sourced live from GitHub via gh GraphQL, not local refs.
	assert.equal(calls[0]?.command, 'gh');
	assert.deepEqual(calls[0]?.args?.slice(0, 2), ['api', 'graphql']);
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
