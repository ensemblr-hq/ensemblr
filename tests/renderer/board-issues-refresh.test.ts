// @vitest-environment happy-dom

import type { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
	prefetchBoardIssues,
	refreshBoardIssues,
} from '../../src/renderer/api/ensemblr/repository-sources';
import type { ListRepositoryIssuesResult } from '../../src/shared/ipc/contracts/workspace-sources';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from './support/dom';

const REPOSITORY_ID = 'repository-1';

/** An empty successful issue list, which is all these assertions read off. */
function issueListResult(): ListRepositoryIssuesResult {
	return {
		issues: [],
		source: 'remote',
		status: 'ok',
		syncedAt: '2026-08-17T00:00:00.000Z',
	};
}

/** Installs a bridge whose issue and Linear lists record every call they get. */
function installRecordingApi() {
	const listRepositoryIssues = vi.fn(async () => issueListResult());
	const linearListIssues = vi.fn(async () => ({ issues: [], status: 'ok' }));
	installEnsemblrApi({ linearListIssues, listRepositoryIssues });
	return { linearListIssues, listRepositoryIssues };
}

/**
 * Waits until nothing is in flight, so the cached rows are fresh rather than
 * pending — `fetchQuery` dedupes onto an in-flight promise, which would hide
 * whether the refresh honours `staleTime`.
 */
async function settleFetches(queryClient: QueryClient): Promise<void> {
	await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
}

afterEach(() => {
	clearEnsemblrApi();
});

describe('refreshBoardIssues', () => {
	// `fetchQuery` resolves straight from cache while the row is fresh, so
	// spreading the query options (staleTime 5min) would make the toolbar's
	// refresh a no-op for five minutes after the board's own prefetch — the
	// button exists precisely to escape a stale list.
	test('re-lists a repository whose cached row is still fresh', async () => {
		const { listRepositoryIssues } = installRecordingApi();
		const queryClient = createTestQueryClient();

		prefetchBoardIssues(queryClient, [REPOSITORY_ID]);
		await settleFetches(queryClient);
		expect(listRepositoryIssues).toHaveBeenCalledTimes(1);

		await refreshBoardIssues(queryClient, [REPOSITORY_ID]);

		expect(listRepositoryIssues).toHaveBeenCalledTimes(2);
		expect(listRepositoryIssues).toHaveBeenLastCalledWith({
			refresh: true,
			repositoryId: REPOSITORY_ID,
			unassignedOnly: true,
		});
	});

	test('re-lists the Linear issues alongside the repositories', async () => {
		const { linearListIssues } = installRecordingApi();
		const queryClient = createTestQueryClient();

		prefetchBoardIssues(queryClient, [REPOSITORY_ID]);
		await settleFetches(queryClient);
		expect(linearListIssues).toHaveBeenCalledTimes(1);

		await refreshBoardIssues(queryClient, [REPOSITORY_ID]);

		expect(linearListIssues).toHaveBeenCalledTimes(2);
	});

	// One repository rejecting must not settle the caller early, or the toolbar
	// drops its spinner while the rest are still listing.
	test('waits for every repository even when one rejects', async () => {
		const failing = 'repository-broken';
		const listRepositoryIssues = vi.fn(
			async ({ repositoryId }: { repositoryId: string }) => {
				if (repositoryId === failing) {
					throw new Error('bridge exploded');
				}
				return issueListResult();
			},
		);
		installEnsemblrApi({
			linearListIssues: async () => ({ issues: [], status: 'ok' }),
			listRepositoryIssues,
		});
		const queryClient = createTestQueryClient();

		await refreshBoardIssues(queryClient, [failing, REPOSITORY_ID]);

		expect(listRepositoryIssues).toHaveBeenCalledTimes(2);
	});
});
