// @vitest-environment happy-dom

import { afterEach, describe, expect, test, vi } from 'vitest';

import { refreshPullRequestSnapshotAfterPush } from '../../src/renderer/api/ensemblr/github';
import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr/query-keys';
import type {
	GetPullRequestSnapshotResult,
	GithubCheckWire,
} from '../../src/shared/ipc/contracts/github';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from './support/dom';

/** A snapshot result for a PR sitting on `headRefOid` with the given checks. */
function snapshotOn(
	headRefOid: string,
	checks: readonly GithubCheckWire[] = [],
): GetPullRequestSnapshotResult {
	return {
		fromCache: false,
		snapshot: {
			branchSync: {
				ahead: 0,
				behind: 0,
				branchName: 'feature',
				hasUpstream: true,
				headSha: headRefOid,
			},
			pullRequest: {
				additions: 1,
				baseRefName: 'main',
				body: '',
				checks,
				comments: [],
				deletions: 0,
				deployments: [],
				headRefName: 'feature',
				headRefOid,
				isDraft: false,
				mergeable: 'mergeable',
				number: 42,
				state: 'open',
				title: 'Add feature',
				updatedAt: '2026-07-11T00:00:01Z',
				url: 'https://github.com/acme/app/pull/42',
			},
			syncedAt: '2026-07-11T00:00:01Z',
		},
	};
}

/** A snapshot result for a branch with no pull request at all. */
const NO_PULL_REQUEST: GetPullRequestSnapshotResult = {
	fromCache: false,
	snapshot: {
		branchSync: null,
		pullRequest: null,
		syncedAt: '2026-07-11T00:00:00Z',
	},
};

const QUEUED: GithubCheckWire = {
	bucket: 'pending',
	id: 'check-1',
	name: 'build',
};

const OLD_HEAD = snapshotOn('aaa111', [
	{ bucket: 'passing', id: 'check-0', name: 'build' },
]);
const NEW_HEAD_WITHOUT_CHECKS = snapshotOn('bbb222');
const NEW_HEAD_WITH_CHECKS = snapshotOn('bbb222', [QUEUED]);

afterEach(() => {
	clearEnsemblrApi();
	vi.restoreAllMocks();
});

describe('refreshPullRequestSnapshotAfterPush', () => {
	test('retries while the PR still names the commit the push replaced', async () => {
		const getPullRequestSnapshot = vi
			.fn()
			.mockResolvedValueOnce(OLD_HEAD)
			.mockResolvedValueOnce(OLD_HEAD)
			.mockResolvedValue(NEW_HEAD_WITH_CHECKS);
		installEnsemblrApi({ getPullRequestSnapshot });
		const queryClient = createTestQueryClient();

		const result = await refreshPullRequestSnapshotAfterPush({
			delaysMs: [1, 1, 1],
			expectsChecks: true,
			pushedHeadSha: 'bbb222',
			queryClient,
			workspaceCwd: '/repo',
			workspaceId: 'ws-1',
		});

		expect(result).toBe(NEW_HEAD_WITH_CHECKS);
		expect(getPullRequestSnapshot).toHaveBeenCalledTimes(3);
		expect(
			queryClient.getQueryData(ensemblrQueryKeys.pullRequestSnapshot('ws-1')),
		).toEqual(NEW_HEAD_WITH_CHECKS);
	});

	test('keeps waiting on a PR that ran checks until the new ones are queued', async () => {
		const getPullRequestSnapshot = vi
			.fn()
			.mockResolvedValueOnce(NEW_HEAD_WITHOUT_CHECKS)
			.mockResolvedValue(NEW_HEAD_WITH_CHECKS);
		installEnsemblrApi({ getPullRequestSnapshot });

		const result = await refreshPullRequestSnapshotAfterPush({
			delaysMs: [1, 1],
			expectsChecks: true,
			pushedHeadSha: 'bbb222',
			queryClient: createTestQueryClient(),
			workspaceCwd: '/repo',
			workspaceId: 'ws-1',
		});

		expect(result).toBe(NEW_HEAD_WITH_CHECKS);
		expect(getPullRequestSnapshot).toHaveBeenCalledTimes(2);
	});

	test('settles on the new head when the PR never reported a check', async () => {
		const getPullRequestSnapshot = vi
			.fn()
			.mockResolvedValue(NEW_HEAD_WITHOUT_CHECKS);
		installEnsemblrApi({ getPullRequestSnapshot });

		const result = await refreshPullRequestSnapshotAfterPush({
			delaysMs: [1, 1],
			expectsChecks: false,
			pushedHeadSha: 'bbb222',
			queryClient: createTestQueryClient(),
			workspaceCwd: '/repo',
			workspaceId: 'ws-1',
		});

		expect(result).toBe(NEW_HEAD_WITHOUT_CHECKS);
		expect(getPullRequestSnapshot).toHaveBeenCalledTimes(1);
	});

	test('does not wait on a branch that has no pull request', async () => {
		const getPullRequestSnapshot = vi.fn().mockResolvedValue(NO_PULL_REQUEST);
		installEnsemblrApi({ getPullRequestSnapshot });

		await refreshPullRequestSnapshotAfterPush({
			delaysMs: [1, 1],
			expectsChecks: true,
			pushedHeadSha: 'bbb222',
			queryClient: createTestQueryClient(),
			workspaceCwd: '/repo',
			workspaceId: 'ws-1',
		});

		expect(getPullRequestSnapshot).toHaveBeenCalledTimes(1);
	});

	test('refreshes once when git could not report what was pushed', async () => {
		const getPullRequestSnapshot = vi.fn().mockResolvedValue(OLD_HEAD);
		installEnsemblrApi({ getPullRequestSnapshot });

		const result = await refreshPullRequestSnapshotAfterPush({
			delaysMs: [1, 1],
			expectsChecks: true,
			pushedHeadSha: null,
			queryClient: createTestQueryClient(),
			workspaceCwd: '/repo',
			workspaceId: 'ws-1',
		});

		expect(result).toBe(OLD_HEAD);
		expect(getPullRequestSnapshot).toHaveBeenCalledTimes(1);
	});

	test('gives up after the retries and returns the last result', async () => {
		const getPullRequestSnapshot = vi.fn().mockResolvedValue(OLD_HEAD);
		installEnsemblrApi({ getPullRequestSnapshot });

		const result = await refreshPullRequestSnapshotAfterPush({
			delaysMs: [1, 1],
			expectsChecks: true,
			pushedHeadSha: 'bbb222',
			queryClient: createTestQueryClient(),
			workspaceCwd: '/repo',
			workspaceId: 'ws-1',
		});

		expect(result).toBe(OLD_HEAD);
		expect(getPullRequestSnapshot).toHaveBeenCalledTimes(3);
	});

	test('stops retrying once the signal aborts', async () => {
		const getPullRequestSnapshot = vi.fn().mockResolvedValue(OLD_HEAD);
		installEnsemblrApi({ getPullRequestSnapshot });
		const controller = new AbortController();

		const pending = refreshPullRequestSnapshotAfterPush({
			delaysMs: [1000, 1000],
			expectsChecks: true,
			pushedHeadSha: 'bbb222',
			queryClient: createTestQueryClient(),
			signal: controller.signal,
			workspaceCwd: '/repo',
			workspaceId: 'ws-1',
		});
		controller.abort();

		expect(await pending).toBe(OLD_HEAD);
		expect(getPullRequestSnapshot).toHaveBeenCalledTimes(1);
	});
});
