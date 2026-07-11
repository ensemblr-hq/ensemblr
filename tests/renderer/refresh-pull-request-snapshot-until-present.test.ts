// @vitest-environment happy-dom

import { afterEach, describe, expect, test, vi } from 'vitest';

import { refreshPullRequestSnapshotUntilPresent } from '../../src/renderer/api/ensemblr/github';
import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr/query-keys';
import type { GetPullRequestSnapshotResult } from '../../src/shared/ipc/contracts/github';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from './support/dom';

/** Snapshot result carrying no PR (the raced "no pull requests found" case). */
const EMPTY: GetPullRequestSnapshotResult = {
	fromCache: false,
	snapshot: {
		branchSync: null,
		pullRequest: null,
		syncedAt: '2026-07-11T00:00:00Z',
	},
};

/** Snapshot result carrying a resolved PR. */
const WITH_PR: GetPullRequestSnapshotResult = {
	fromCache: false,
	snapshot: {
		branchSync: null,
		pullRequest: {
			additions: 1,
			baseRefName: 'main',
			body: '',
			checks: [],
			comments: [],
			deletions: 0,
			deployments: [],
			headRefName: 'feature',
			headRefOid: 'abc123',
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

afterEach(() => {
	clearEnsemblrApi();
	vi.restoreAllMocks();
});

describe('refreshPullRequestSnapshotUntilPresent', () => {
	test('retries until the PR surfaces, then writes it to the cache', async () => {
		const getPullRequestSnapshot = vi
			.fn()
			.mockResolvedValueOnce(EMPTY)
			.mockResolvedValueOnce(EMPTY)
			.mockResolvedValue(WITH_PR);
		installEnsemblrApi({ getPullRequestSnapshot });
		const queryClient = createTestQueryClient();

		const result = await refreshPullRequestSnapshotUntilPresent({
			delaysMs: [1, 1, 1],
			queryClient,
			workspaceCwd: '/repo',
			workspaceId: 'ws-1',
		});

		expect(result).toBe(WITH_PR);
		expect(getPullRequestSnapshot).toHaveBeenCalledTimes(3);
		expect(
			queryClient.getQueryData(ensemblrQueryKeys.pullRequestSnapshot('ws-1')),
		).toEqual(WITH_PR);
	});

	test('does not retry when the first snapshot already has a PR', async () => {
		const getPullRequestSnapshot = vi.fn().mockResolvedValue(WITH_PR);
		installEnsemblrApi({ getPullRequestSnapshot });
		const queryClient = createTestQueryClient();

		await refreshPullRequestSnapshotUntilPresent({
			delaysMs: [1, 1, 1],
			queryClient,
			workspaceCwd: '/repo',
			workspaceId: 'ws-1',
		});

		expect(getPullRequestSnapshot).toHaveBeenCalledTimes(1);
	});

	test('stops retrying once the signal aborts', async () => {
		const getPullRequestSnapshot = vi.fn().mockResolvedValue(EMPTY);
		installEnsemblrApi({ getPullRequestSnapshot });
		const queryClient = createTestQueryClient();
		const controller = new AbortController();

		const pending = refreshPullRequestSnapshotUntilPresent({
			delaysMs: [1000, 1000, 1000],
			queryClient,
			signal: controller.signal,
			workspaceCwd: '/repo',
			workspaceId: 'ws-1',
		});
		controller.abort();
		const result = await pending;

		expect(result).toBe(EMPTY);
		expect(getPullRequestSnapshot).toHaveBeenCalledTimes(1);
	});

	test('gives up after exhausting retries and returns the last empty result', async () => {
		const getPullRequestSnapshot = vi.fn().mockResolvedValue(EMPTY);
		installEnsemblrApi({ getPullRequestSnapshot });
		const queryClient = createTestQueryClient();

		const result = await refreshPullRequestSnapshotUntilPresent({
			delaysMs: [1, 1],
			queryClient,
			workspaceCwd: '/repo',
			workspaceId: 'ws-1',
		});

		expect(result).toBe(EMPTY);
		expect(getPullRequestSnapshot).toHaveBeenCalledTimes(3);
	});
});
