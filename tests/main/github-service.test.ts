import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type {
	LocalCommandRequest,
	LocalCommandResult,
	LocalCommandService,
} from '../../src/main/commands/local-command';
import {
	createGithubService,
	type GithubService,
} from '../../src/main/github/github-service.ts';
import {
	parsePullRequestView,
	parseReviewThreads,
	parseStatusCheckRollup,
} from '../../src/main/github/pr-snapshot.ts';
import type { EnsemblrDatabaseService } from '../../src/main/storage';

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

function createTestDatabase(): DatabaseSync {
	const database = new DatabaseSync(':memory:');
	database.exec(`CREATE TABLE integration_metadata (
		id TEXT PRIMARY KEY,
		provider TEXT NOT NULL,
		resource_type TEXT NOT NULL,
		resource_id TEXT NOT NULL,
		external_id TEXT NOT NULL DEFAULT '',
		synced_at TEXT,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		metadata_json TEXT NOT NULL DEFAULT '{}',
		UNIQUE(provider, resource_type, resource_id, external_id)
	) STRICT;`);
	return database;
}

function stubDatabaseService(database: DatabaseSync): EnsemblrDatabaseService {
	return {
		close: () => undefined,
		getConnection: () => ({ database }) as never,
		getHealth: () => ({}) as never,
		open: () => ({}) as never,
	};
}

function createService(
	respond: (request: LocalCommandRequest) => LocalCommandResult,
	database = createTestDatabase(),
): { calls: LocalCommandRequest[]; service: GithubService } {
	const { calls, service } = stubCommandService(respond);
	return {
		calls,
		service: createGithubService({
			databaseService: stubDatabaseService(database),
			localCommandService: service,
			now: fixedNow,
		}),
	};
}

const PR_VIEW_JSON = JSON.stringify({
	additions: 12,
	baseRefName: 'master',
	body: 'PR body',
	comments: [
		{
			author: { login: 'octocat' },
			body: 'Looks good',
			createdAt: '2026-06-10T10:00:00Z',
			id: 'IC_1',
			url: 'https://github.com/o/r/pull/7#issuecomment-1',
		},
	],
	deletions: 3,
	headRefName: 'feature/x',
	headRefOid: 'feature-tip-oid',
	isDraft: false,
	mergeStateStatus: 'CLEAN',
	mergeable: 'MERGEABLE',
	number: 7,
	reviewDecision: 'APPROVED',
	reviews: [],
	state: 'OPEN',
	statusCheckRollup: [
		{
			__typename: 'CheckRun',
			completedAt: '2026-06-10T10:05:00Z',
			conclusion: 'SUCCESS',
			detailsUrl: 'https://ci.example/run/1',
			name: 'build',
			startedAt: '2026-06-10T10:00:00Z',
			status: 'COMPLETED',
			workflowName: 'CI',
		},
		{
			__typename: 'CheckRun',
			conclusion: '',
			name: 'tests',
			status: 'IN_PROGRESS',
		},
		{
			__typename: 'StatusContext',
			context: 'deploy/preview',
			state: 'FAILURE',
			targetUrl: 'https://vercel.example/d/1',
		},
	],
	title: 'Add feature',
	updatedAt: '2026-06-10T10:06:00Z',
	url: 'https://github.com/o/r/pull/7',
});

test('parsePullRequestView maps fields and check buckets', () => {
	const pullRequest = parsePullRequestView(PR_VIEW_JSON);

	assert.equal(pullRequest.number, 7);
	assert.equal(pullRequest.state, 'open');
	assert.equal(pullRequest.headRefOid, 'feature-tip-oid');
	assert.equal(pullRequest.mergeable, 'mergeable');
	assert.equal(pullRequest.reviewDecision, 'APPROVED');
	assert.deepEqual(
		pullRequest.checks.map((check) => [check.name, check.bucket]),
		[
			['build', 'passing'],
			['tests', 'pending'],
			['deploy/preview', 'failing'],
		],
	);
	assert.equal(pullRequest.comments.length, 1);
	assert.equal(pullRequest.comments[0]?.kind, 'issue-comment');
});

test('parseStatusCheckRollup buckets skipped and failed conclusions', () => {
	const checks = parseStatusCheckRollup([
		{
			__typename: 'CheckRun',
			conclusion: 'SKIPPED',
			name: 'a',
			status: 'COMPLETED',
		},
		{
			__typename: 'CheckRun',
			conclusion: 'FAILURE',
			name: 'b',
			status: 'COMPLETED',
		},
		{
			__typename: 'CheckRun',
			conclusion: 'NEUTRAL',
			name: 'c',
			status: 'COMPLETED',
		},
	]);
	assert.deepEqual(
		checks.map((check) => check.bucket),
		['skipped', 'failing', 'passing'],
	);
});

test('parseReviewThreads keeps resolution state', () => {
	const comments = parseReviewThreads({
		nodes: [
			{
				comments: {
					nodes: [
						{
							author: { login: 'octocat' },
							body: 'Fix this',
							createdAt: '2026-06-10T10:00:00Z',
							id: 'RC_1',
							line: 12,
							path: 'src/app.ts',
							url: 'https://github.com/o/r/pull/7#discussion_r1',
						},
					],
				},
				isResolved: false,
			},
		],
	});

	assert.equal(comments.length, 1);
	assert.equal(comments[0]?.isResolved, false);
	assert.equal(comments[0]?.kind, 'review-comment');
	assert.equal(comments[0]?.path, 'src/app.ts');
});

test('commitWorkspaceChanges stages, commits, and reports the hash', async () => {
	const { calls, service } = createService((request) => {
		if (request.args?.[0] === 'rev-parse') {
			return buildResult({ stdout: 'abc123\n' });
		}
		return buildResult();
	});

	const result = await service.commitWorkspaceChanges({
		message: 'feat: change',
		workspaceCwd: '/tmp/ws',
	});

	assert.equal(result.ok, true);
	assert.equal(result.commitHash, 'abc123');
	assert.deepEqual(calls[0]?.args, ['add', '--all']);
	assert.deepEqual(calls[1]?.args, ['commit', '-m', 'feat: change']);
});

test('commitWorkspaceChanges stages only requested paths', async () => {
	const { calls, service } = createService(() => buildResult());

	await service.commitWorkspaceChanges({
		message: 'fix: scoped',
		paths: ['src/a.ts', 'src/b.ts'],
		workspaceCwd: '/tmp/ws',
	});

	assert.deepEqual(calls[0]?.args, ['add', '--', 'src/a.ts', 'src/b.ts']);
});

test('commitWorkspaceChanges classifies nothing-to-commit', async () => {
	const { service } = createService((request) =>
		request.args?.[0] === 'commit'
			? buildResult({
					exitCode: 1,
					status: 'failure',
					stdout: 'nothing to commit, working tree clean',
				})
			: buildResult(),
	);

	const result = await service.commitWorkspaceChanges({
		message: 'noop',
		workspaceCwd: '/tmp/ws',
	});

	assert.equal(result.ok, false);
	assert.equal(result.error?.code, 'nothing-to-commit');
});

test('pushWorkspaceBranch surfaces auth failures with remediation', async () => {
	const { service } = createService(() =>
		buildResult({
			exitCode: 1,
			status: 'failure',
			stderr:
				'fatal: could not read Username — run gh auth login to authenticate',
		}),
	);

	const result = await service.pushWorkspaceBranch({
		workspaceCwd: '/tmp/ws',
	});

	assert.equal(result.ok, false);
	assert.equal(result.error?.code, 'gh-not-authenticated');
	assert.ok(result.error?.remediation);
});

test('pushWorkspaceBranch sets upstream by default', async () => {
	const { calls, service } = createService(() => buildResult());

	const result = await service.pushWorkspaceBranch({ workspaceCwd: '/tmp/ws' });

	assert.equal(result.ok, true);
	const push = calls.find(
		(call) => call.command === 'git' && call.args[0] === 'push',
	);
	assert.deepEqual(push?.args, ['push', '--set-upstream', 'origin', 'HEAD']);
});

test('pushWorkspaceBranch omits --set-upstream when disabled', async () => {
	const { calls, service } = createService(() => buildResult());

	const result = await service.pushWorkspaceBranch({
		setUpstream: false,
		workspaceCwd: '/tmp/ws',
	});

	assert.equal(result.ok, true);
	const push = calls.find(
		(call) => call.command === 'git' && call.args[0] === 'push',
	);
	assert.deepEqual(push?.args, ['push', 'origin', 'HEAD']);
});

test('createPullRequest parses URL and number from stdout', async () => {
	const { calls, service } = createService(() =>
		buildResult({ stdout: 'https://github.com/o/r/pull/42\n' }),
	);

	const result = await service.createPullRequest({
		baseBranch: 'master',
		body: 'Body',
		title: 'Title',
		workspaceCwd: '/tmp/ws',
	});

	assert.equal(result.ok, true);
	assert.equal(result.pullRequestNumber, 42);
	assert.equal(result.pullRequestUrl, 'https://github.com/o/r/pull/42');
	assert.deepEqual(calls[0]?.args?.slice(0, 2), ['pr', 'create']);
	assert.ok(calls[0]?.args?.includes('--base'));
});

test('getPullRequestSnapshot returns no-PR snapshot when gh finds none', async () => {
	const { service } = createService((request) => {
		if (request.command === 'git') {
			return request.args?.[0] === 'rev-parse'
				? buildResult({ stdout: 'feature/x\n' })
				: buildResult({ stdout: '0\t0\n' });
		}
		return buildResult({
			exitCode: 1,
			status: 'failure',
			stderr: 'no pull requests found for branch "feature/x"',
		});
	});

	const result = await service.getPullRequestSnapshot({
		workspaceCwd: '/tmp/ws',
		workspaceId: 'ws-1',
	});

	assert.equal(result.error, undefined);
	assert.equal(result.snapshot?.pullRequest, null);
	assert.equal(result.snapshot?.branchSync?.branchName, 'feature/x');
});

test('getPullRequestSnapshot caches and serves fresh snapshots', async () => {
	const database = createTestDatabase();
	let ghViewCalls = 0;
	const { service } = createService((request) => {
		if (request.command === 'git') {
			return request.args?.[0] === 'rev-parse'
				? buildResult({ stdout: 'feature/x\n' })
				: buildResult({ stdout: '0\t1\n' });
		}
		if (request.args?.[0] === 'pr' && request.args?.[1] === 'view') {
			ghViewCalls += 1;
			return buildResult({ stdout: PR_VIEW_JSON });
		}
		// Deployments / graphql enrichment calls fail quietly in this fixture.
		return buildResult({ exitCode: 1, status: 'failure', stderr: 'HTTP 404' });
	}, database);

	const first = await service.getPullRequestSnapshot({
		refresh: true,
		workspaceCwd: '/tmp/ws',
		workspaceId: 'ws-1',
	});
	assert.equal(first.fromCache, false);
	assert.equal(first.snapshot?.pullRequest?.number, 7);

	const second = await service.getPullRequestSnapshot({
		workspaceCwd: '/tmp/ws',
		workspaceId: 'ws-1',
	});
	assert.equal(second.fromCache, true);
	assert.equal(second.snapshot?.pullRequest?.number, 7);
	assert.equal(ghViewCalls, 1);
});

test('getPullRequestSnapshot keeps cache visible when refresh fails', async () => {
	const database = createTestDatabase();
	let failNext = false;
	const { service } = createService((request) => {
		if (request.command === 'git') {
			return request.args?.[0] === 'rev-parse'
				? buildResult({ stdout: 'feature/x\n' })
				: buildResult({ stdout: '0\t0\n' });
		}
		if (request.args?.[0] === 'pr' && request.args?.[1] === 'view') {
			if (failNext) {
				return buildResult({
					exitCode: 1,
					status: 'failure',
					stderr: 'gh: connection refused',
				});
			}
			return buildResult({ stdout: PR_VIEW_JSON });
		}
		return buildResult({ exitCode: 1, status: 'failure', stderr: 'HTTP 404' });
	}, database);

	await service.getPullRequestSnapshot({
		refresh: true,
		workspaceCwd: '/tmp/ws',
		workspaceId: 'ws-1',
	});
	failNext = true;
	const result = await service.getPullRequestSnapshot({
		refresh: true,
		workspaceCwd: '/tmp/ws',
		workspaceId: 'ws-1',
	});

	assert.equal(result.error?.code, 'command-failed');
	assert.equal(result.fromCache, true);
	assert.equal(result.snapshot?.pullRequest?.number, 7);
});

test('mergePullRequest reports blocked merges without retry', async () => {
	const { calls, service } = createService((request) => {
		if (request.command === 'gh' && request.args?.[1] === 'merge') {
			return buildResult({
				exitCode: 1,
				status: 'failure',
				stderr: 'Pull request is not mergeable: required status check failing',
			});
		}
		return buildResult();
	});

	const result = await service.mergePullRequest({
		workspaceCwd: '/tmp/ws',
		workspaceId: 'ws-1',
	});

	assert.equal(result.merged, false);
	assert.equal(result.error?.code, 'merge-blocked');
	const mergeCalls = calls.filter((call) => call.args?.[1] === 'merge');
	assert.equal(mergeCalls.length, 1);
});

test('mergePullRequest uses the requested merge method', async () => {
	const { calls, service } = createService((request) => {
		if (request.command === 'gh' && request.args?.[1] === 'view') {
			return buildResult({ stdout: PR_VIEW_JSON });
		}
		if (request.command === 'git') {
			return request.args?.[0] === 'rev-parse'
				? buildResult({ stdout: 'feature/x\n' })
				: buildResult({ stdout: '0\t0\n' });
		}
		return buildResult();
	});

	const result = await service.mergePullRequest({
		method: 'rebase',
		workspaceCwd: '/tmp/ws',
		workspaceId: 'ws-1',
	});

	assert.equal(result.merged, true);
	const mergeCall = calls.find((call) => call.args?.[1] === 'merge');
	assert.ok(mergeCall?.args?.includes('--rebase'));
});

test('getPullRequestSnapshot drops a closed PR whose head is not on the branch', async () => {
	const { calls, service } = createService((request) => {
		if (request.command === 'git') {
			if (request.args?.[0] === 'rev-parse') {
				return buildResult({ stdout: 'feature/x\n' });
			}
			if (request.args?.[0] === 'merge-base') {
				// Stale PR head commit is not reachable from HEAD (reused branch).
				return buildResult({ exitCode: 1, status: 'failure' });
			}
			return buildResult({ stdout: '0\t0\n' });
		}
		if (request.args?.[0] === 'pr' && request.args?.[1] === 'view') {
			return buildResult({
				stdout: JSON.stringify({
					...JSON.parse(PR_VIEW_JSON),
					headRefOid: 'stale-oid',
					state: 'CLOSED',
				}),
			});
		}
		return buildResult({ exitCode: 1, status: 'failure', stderr: 'HTTP 404' });
	});

	const result = await service.getPullRequestSnapshot({
		refresh: true,
		workspaceCwd: '/tmp/ws',
		workspaceId: 'ws-1',
	});

	assert.equal(result.error, undefined);
	assert.equal(result.snapshot?.pullRequest, null);
	const ancestorCall = calls.find((call) => call.args?.[0] === 'merge-base');
	assert.deepEqual(ancestorCall?.args, [
		'merge-base',
		'--is-ancestor',
		'stale-oid',
		'HEAD',
	]);
});

test('getPullRequestSnapshot keeps a merged PR whose head is on the branch', async () => {
	const { service } = createService((request) => {
		if (request.command === 'git') {
			if (request.args?.[0] === 'rev-parse') {
				return buildResult({ stdout: 'feature/x\n' });
			}
			if (request.args?.[0] === 'merge-base') {
				// Head commit is reachable from HEAD — a genuine merged PR.
				return buildResult({ exitCode: 0 });
			}
			return buildResult({ stdout: '0\t0\n' });
		}
		if (request.args?.[0] === 'pr' && request.args?.[1] === 'view') {
			return buildResult({
				stdout: JSON.stringify({
					...JSON.parse(PR_VIEW_JSON),
					headRefOid: 'branch-tip',
					state: 'MERGED',
				}),
			});
		}
		return buildResult({ exitCode: 1, status: 'failure', stderr: 'HTTP 404' });
	});

	const result = await service.getPullRequestSnapshot({
		refresh: true,
		workspaceCwd: '/tmp/ws',
		workspaceId: 'ws-1',
	});

	assert.equal(result.snapshot?.pullRequest?.number, 7);
	assert.equal(result.snapshot?.pullRequest?.state, 'merged');
});

test('getPullRequestSnapshot keeps a closed PR whose head is on the branch', async () => {
	const { service } = createService((request) => {
		if (request.command === 'git') {
			if (request.args?.[0] === 'rev-parse') {
				return buildResult({ stdout: 'feature/x\n' });
			}
			if (request.args?.[0] === 'merge-base') {
				// Head commit is reachable — a PR closed without merging, not a
				// stale name match. It must survive.
				return buildResult({ exitCode: 0 });
			}
			return buildResult({ stdout: '0\t0\n' });
		}
		if (request.args?.[0] === 'pr' && request.args?.[1] === 'view') {
			return buildResult({
				stdout: JSON.stringify({
					...JSON.parse(PR_VIEW_JSON),
					headRefOid: 'branch-tip',
					state: 'CLOSED',
				}),
			});
		}
		return buildResult({ exitCode: 1, status: 'failure', stderr: 'HTTP 404' });
	});

	const result = await service.getPullRequestSnapshot({
		refresh: true,
		workspaceCwd: '/tmp/ws',
		workspaceId: 'ws-1',
	});

	assert.equal(result.snapshot?.pullRequest?.number, 7);
	assert.equal(result.snapshot?.pullRequest?.state, 'closed');
});

test('getPullRequestSnapshot keeps a closed PR when gh omits the head oid', async () => {
	const { calls, service } = createService((request) => {
		if (request.command === 'git') {
			if (request.args?.[0] === 'rev-parse') {
				return buildResult({ stdout: 'feature/x\n' });
			}
			return buildResult({ stdout: '0\t0\n' });
		}
		if (request.args?.[0] === 'pr' && request.args?.[1] === 'view') {
			return buildResult({
				stdout: JSON.stringify({
					...JSON.parse(PR_VIEW_JSON),
					headRefOid: '',
					state: 'CLOSED',
				}),
			});
		}
		return buildResult({ exitCode: 1, status: 'failure', stderr: 'HTTP 404' });
	});

	const result = await service.getPullRequestSnapshot({
		refresh: true,
		workspaceCwd: '/tmp/ws',
		workspaceId: 'ws-1',
	});

	// No oid to verify against — keep the PR and skip the ancestry probe.
	assert.equal(result.snapshot?.pullRequest?.number, 7);
	const ancestorCall = calls.find((call) => call.args?.[0] === 'merge-base');
	assert.equal(ancestorCall, undefined);
});

test('getPullRequestSnapshot keeps a closed PR when the ancestry check cannot run', async () => {
	const { service } = createService((request) => {
		if (request.command === 'git') {
			if (request.args?.[0] === 'rev-parse') {
				return buildResult({ stdout: 'feature/x\n' });
			}
			if (request.args?.[0] === 'merge-base') {
				// git produced no exit code (timeout / spawn failure) — cannot
				// verify, so the PR must not be suppressed on a transient hiccup.
				return buildResult({ exitCode: null, status: 'failure' });
			}
			return buildResult({ stdout: '0\t0\n' });
		}
		if (request.args?.[0] === 'pr' && request.args?.[1] === 'view') {
			return buildResult({
				stdout: JSON.stringify({
					...JSON.parse(PR_VIEW_JSON),
					headRefOid: 'unknown-oid',
					state: 'CLOSED',
				}),
			});
		}
		return buildResult({ exitCode: 1, status: 'failure', stderr: 'HTTP 404' });
	});

	const result = await service.getPullRequestSnapshot({
		refresh: true,
		workspaceCwd: '/tmp/ws',
		workspaceId: 'ws-1',
	});

	assert.equal(result.snapshot?.pullRequest?.number, 7);
	assert.equal(result.snapshot?.pullRequest?.state, 'closed');
});
