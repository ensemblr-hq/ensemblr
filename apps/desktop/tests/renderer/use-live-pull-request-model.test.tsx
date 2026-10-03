// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, test } from 'vitest';

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr/query-keys';
import { useLivePullRequestModel } from '../../src/renderer/hooks/workbench-shell/route-layout/use-live-pull-request-model';
import type { WorkspaceShellModel } from '../../src/renderer/types/workbench';
import type {
	GetPullRequestSnapshotResult,
	GithubPullRequestWire,
} from '../../src/shared/ipc/contracts/github';
import type {
	RepositoryWorkspaceNavigationSnapshot,
	WorkspacePrPresentation,
	WorkspacePrPresentationStatus,
} from '../../src/shared/ipc/contracts/repository-navigation';
import { createTestQueryClient } from './support/dom';

const WORKSPACE_ID = 'workspace-1';
const WORKSPACE_CWD = '/repo/feature';
const EARLIER = '2026-07-15T09:00:00.000Z';
const MIDDLE = '2026-07-15T09:15:00.000Z';
const LATER = '2026-07-15T09:30:00.000Z';

/**
 * A clean worktree, held as one object the way the hook's callers memoize it, so
 * a re-render alone does not count as new input.
 */
const NO_CHANGES: WorkspaceShellModel['changeSummary'] = {
	additions: 0,
	deletions: 0,
	files: 0,
};

/** A neutral fallback PR model standing in for the navigation snapshot's state. */
const FALLBACK_PULL_REQUEST: WorkspaceShellModel['pullRequest'] = {
	checks: [],
	comments: [],
	description: [],
	detail: 'Pull request is open.',
	gitStatus: { kind: 'clean', label: 'Up to date with remote', status: 'open' },
	label: 'PR #7',
	number: 7,
	state: 'open',
	status: 'idle',
	title: 'PR #7',
	todos: [],
};

/**
 * The fallback as the navigation poll delivers it once the background sweeper
 * has observed a ready pull request. Its stamp travels separately, in the
 * snapshot's `pullRequestSyncedAt`, which is what `fallbackSyncedAt` seeds.
 */
const READY_FALLBACK: WorkspaceShellModel['pullRequest'] = {
	...FALLBACK_PULL_REQUEST,
	status: 'ready-to-merge',
};

/** The compact status each fallback status in these tests is mapped from. */
const PRESENTATION_STATUS_OF: Partial<
	Record<
		WorkspaceShellModel['pullRequest']['status'],
		WorkspacePrPresentationStatus
	>
> = {
	blocked: 'blocked',
	checking: 'checking',
	idle: 'open',
	'ready-to-merge': 'ready',
};

/**
 * The presentation a navigation row would have mapped `pullRequest` from — what
 * the cache holds when `pullRequest` is current rather than held.
 */
function presentationStating(
	pullRequest: WorkspaceShellModel['pullRequest'],
): WorkspacePrPresentation {
	return {
		branchSync: null,
		number: pullRequest.number ?? 0,
		status: PRESENTATION_STATUS_OF[pullRequest.status] ?? 'open',
	};
}

/**
 * A navigation snapshot holding this workspace's presentation observed at
 * `syncedAt`, or holding no pull request for it when there is no stamp.
 */
function navigationSnapshotStamped(
	syncedAt: string | undefined,
	presentation: WorkspacePrPresentation,
): RepositoryWorkspaceNavigationSnapshot {
	return {
		generatedAt: syncedAt ?? EARLIER,
		pullRequestSyncedAt: syncedAt ? { [WORKSPACE_ID]: syncedAt } : {},
		repositories: [
			{
				createdAt: EARLIER,
				defaultBranch: 'main',
				id: 'repo-1',
				metadata: {},
				name: 'repo',
				path: '/repo',
				slug: 'repo',
				updatedAt: EARLIER,
				workspaces: [
					{
						archivedAt: null,
						baseBranch: 'main',
						branchName: 'feature',
						createdAt: EARLIER,
						id: WORKSPACE_ID,
						metadata: {},
						name: 'Feature',
						path: WORKSPACE_CWD,
						pullRequest: syncedAt ? presentation : null,
						repositoryId: 'repo-1',
						slug: 'feature',
						updatedAt: EARLIER,
					},
				],
			},
		],
	};
}

/** Builds a ready-to-merge PR wire record (open, clean, mergeable, approved). */
function readyPullRequestWire(): GithubPullRequestWire {
	return {
		additions: 1,
		baseRefName: 'main',
		body: 'A described pull request.',
		checks: [{ bucket: 'passing', id: 'check-1', name: 'build' }],
		comments: [],
		deletions: 0,
		deployments: [],
		headRefName: 'feature',
		headRefOid: 'abc123',
		isDraft: false,
		mergeable: 'mergeable',
		mergeStateStatus: 'CLEAN',
		number: 7,
		reviewDecision: 'APPROVED',
		state: 'open',
		title: 'PR #7',
		updatedAt: '2026-07-15T00:00:00.000Z',
		url: 'https://example.test/pr/7',
	};
}

/** Seeds a ready-to-merge snapshot result stamped at the given instant. */
function readySnapshotAt(syncedAt: string): GetPullRequestSnapshotResult {
	return {
		fromCache: true,
		snapshot: {
			branchSync: null,
			pullRequest: readyPullRequestWire(),
			syncedAt,
		},
	};
}

/** Seeds a checks-running snapshot result stamped at the given instant. */
function checkingSnapshotAt(syncedAt: string): GetPullRequestSnapshotResult {
	return {
		fromCache: true,
		snapshot: {
			branchSync: null,
			pullRequest: {
				...readyPullRequestWire(),
				checks: [{ bucket: 'pending', id: 'check-1', name: 'build' }],
			},
			syncedAt,
		},
	};
}

/** Seeds a conflicting snapshot result stamped at the given instant. */
function conflictingSnapshotAt(syncedAt: string): GetPullRequestSnapshotResult {
	return {
		fromCache: true,
		snapshot: {
			branchSync: null,
			pullRequest: { ...readyPullRequestWire(), mergeable: 'conflicting' },
			syncedAt,
		},
	};
}

/**
 * Seeds the navigation observation and the live snapshot into the query cache
 * and renders the hook against them, handing back the client so a test can move
 * either source afterwards. The cached presentation states `fallback`'s verdict
 * unless `cachedPresentation` says otherwise — the held-render-state case.
 */
function renderLivePullRequest(options: {
	cachedPresentation?: WorkspacePrPresentation;
	enabled?: boolean;
	fallback?: WorkspaceShellModel['pullRequest'];
	fallbackSyncedAt?: string;
	seed?: GetPullRequestSnapshotResult;
}) {
	const fallback = options.fallback ?? FALLBACK_PULL_REQUEST;
	const client = createTestQueryClient();
	client.setQueryData(
		ensemblrQueryKeys.repositoryWorkspaceNavigation(),
		navigationSnapshotStamped(
			options.fallbackSyncedAt,
			options.cachedPresentation ?? presentationStating(fallback),
		),
	);
	if (options.seed) {
		client.setQueryData(
			ensemblrQueryKeys.pullRequestSnapshot(WORKSPACE_ID),
			options.seed,
		);
	}
	const wrapper = ({ children }: PropsWithChildren) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	let renders = 0;
	const rendered = renderHook(
		() => {
			renders += 1;
			return useLivePullRequestModel({
				changeSummary: NO_CHANGES,
				enabled: options.enabled ?? true,
				fallback,
				workspaceCwd: WORKSPACE_CWD,
				workspaceId: WORKSPACE_ID,
			});
		},
		{ wrapper },
	);
	return { ...rendered, client, renderCount: () => renders };
}

describe('useLivePullRequestModel', () => {
	test('derives ready-to-merge from the seeded live snapshot', () => {
		const { result } = renderLivePullRequest({
			seed: {
				fromCache: true,
				snapshot: {
					branchSync: null,
					pullRequest: readyPullRequestWire(),
					syncedAt: '2026-07-15T00:00:00.000Z',
				},
			},
		});
		expect(result.current.status).toBe('ready-to-merge');
		expect(result.current.number).toBe(7);
	});

	test('returns the fallback reference until a snapshot lands', () => {
		const { result } = renderLivePullRequest({});
		expect(result.current).toBe(FALLBACK_PULL_REQUEST);
	});

	test('keeps a fresher cached presentation over a stale live snapshot', () => {
		const { result } = renderLivePullRequest({
			fallback: READY_FALLBACK,
			fallbackSyncedAt: LATER,
			seed: checkingSnapshotAt(EARLIER),
		});
		expect(result.current.status).toBe('ready-to-merge');
	});

	test('a fresher cached verdict keeps the live snapshot body', () => {
		const { result } = renderLivePullRequest({
			fallback: READY_FALLBACK,
			fallbackSyncedAt: LATER,
			seed: checkingSnapshotAt(EARLIER),
		});
		expect(result.current.title).toBe('PR #7');
		expect(result.current.url).toBe('https://example.test/pr/7');
		expect(result.current.checks).toHaveLength(1);
		expect(result.current.description).toHaveLength(1);
		expect(result.current.gitStatus.kind).toBe('clean');
		expect(result.current.number).toBe(7);
	});

	test('a fresher cached verdict off blocked denies a stale conflict', () => {
		const { result } = renderLivePullRequest({
			fallback: READY_FALLBACK,
			fallbackSyncedAt: LATER,
			seed: conflictingSnapshotAt(EARLIER),
		});
		expect(result.current.status).toBe('ready-to-merge');
		expect(result.current.isConflicting).toBe(false);
	});

	test('a fresher cached verdict still blocked carries the conflict through', () => {
		const { result } = renderLivePullRequest({
			fallback: { ...READY_FALLBACK, status: 'blocked' },
			fallbackSyncedAt: LATER,
			seed: conflictingSnapshotAt(EARLIER),
		});
		expect(result.current.status).toBe('blocked');
		expect(result.current.isConflicting).toBe(true);
	});

	test('a fresher cached verdict for another PR replaces the model outright', () => {
		const cached = { ...READY_FALLBACK, number: 43 };
		const { result } = renderLivePullRequest({
			fallback: cached,
			fallbackSyncedAt: LATER,
			seed: checkingSnapshotAt(EARLIER),
		});
		expect(result.current).toBe(cached);
		expect(result.current.url).toBeUndefined();
	});

	test('a failed refresh with no snapshot never unseats a cached pull request', () => {
		const { result } = renderLivePullRequest({
			fallback: READY_FALLBACK,
			fallbackSyncedAt: LATER,
			seed: {
				error: { code: 'gh-not-installed', message: 'gh is not installed.' },
				fromCache: false,
				snapshot: null,
			},
		});
		expect(result.current.number).toBe(7);
		expect(result.current.status).toBe('ready-to-merge');
		expect(result.current.syncError).toBeDefined();
	});

	test('a failed refresh still reports itself when nothing is cached', () => {
		const { result } = renderLivePullRequest({
			seed: {
				error: { code: 'gh-not-installed', message: 'gh is not installed.' },
				fromCache: false,
				snapshot: null,
			},
		});
		expect(result.current.number).toBeUndefined();
		expect(result.current.syncError).toBeDefined();
	});

	test('takes the live snapshot once it observes GitHub later', () => {
		const { result } = renderLivePullRequest({
			fallback: READY_FALLBACK,
			fallbackSyncedAt: EARLIER,
			seed: checkingSnapshotAt(LATER),
		});
		expect(result.current.status).toBe('checking');
	});

	test('an unstamped fallback never holds back a live snapshot', () => {
		const { result } = renderLivePullRequest({
			seed: readySnapshotAt(EARLIER),
		});
		expect(result.current.status).toBe('ready-to-merge');
	});

	test('a disabled row still renders a live snapshot fresher than its fallback', () => {
		const { result } = renderLivePullRequest({
			enabled: false,
			fallback: { ...READY_FALLBACK, status: 'checking' },
			fallbackSyncedAt: EARLIER,
			seed: readySnapshotAt(LATER),
		});
		expect(result.current.status).toBe('ready-to-merge');
	});

	test('a disabled row falls back once the cached presentation overtakes it', () => {
		const { result } = renderLivePullRequest({
			enabled: false,
			fallback: READY_FALLBACK,
			fallbackSyncedAt: LATER,
			seed: checkingSnapshotAt(EARLIER),
		});
		expect(result.current.status).toBe('ready-to-merge');
	});

	// The sequence that sank the content-signature attempt (#627): the sweeper
	// observes the same status twice, so the navigation model stays the same
	// object across both, and only the stamp beside it can say that the second
	// observation came after the live snapshot read in between.
	test('a re-stamped, unchanged presentation overtakes a live read made in between', async () => {
		const checkingFallback = {
			...READY_FALLBACK,
			status: 'checking' as const,
		};
		const { client, result } = renderLivePullRequest({
			enabled: false,
			fallback: checkingFallback,
			fallbackSyncedAt: EARLIER,
		});
		expect(result.current).toBe(checkingFallback);

		act(() => {
			client.setQueryData(
				ensemblrQueryKeys.pullRequestSnapshot(WORKSPACE_ID),
				readySnapshotAt(MIDDLE),
			);
		});
		await waitFor(() => {
			expect(result.current.status).toBe('ready-to-merge');
		});

		act(() => {
			client.setQueryData(
				ensemblrQueryKeys.repositoryWorkspaceNavigation(),
				navigationSnapshotStamped(LATER, presentationStating(checkingFallback)),
			);
		});
		await waitFor(() => {
			expect(result.current.status).toBe('checking');
		});
		expect(result.current.title).toBe('PR #7');
	});

	test('a stamp that moves without changing the winner keeps the same model', async () => {
		const checkingFallback = {
			...READY_FALLBACK,
			status: 'checking' as const,
		};
		const { client, renderCount, result } = renderLivePullRequest({
			enabled: false,
			fallback: checkingFallback,
			fallbackSyncedAt: EARLIER,
			seed: readySnapshotAt(LATER),
		});
		const before = result.current;
		const rendersBefore = renderCount();
		expect(before.status).toBe('ready-to-merge');

		act(() => {
			client.setQueryData(
				ensemblrQueryKeys.repositoryWorkspaceNavigation(),
				navigationSnapshotStamped(
					MIDDLE,
					presentationStating(checkingFallback),
				),
			);
		});
		await waitFor(() => {
			expect(renderCount()).toBeGreaterThan(rendersBefore);
		});
		expect(result.current).toBe(before);
	});

	// While a fetch is in flight with no resolvable selection, the shell renders a
	// project list held from an older snapshot. Its model must not borrow the
	// newer stamp the cache holds for a different verdict, or an older status
	// would outrank a live read made after it.
	test('a fallback held from an older snapshot does not borrow the current stamp', () => {
		const { result } = renderLivePullRequest({
			cachedPresentation: { branchSync: null, number: 7, status: 'ready' },
			enabled: false,
			fallback: { ...READY_FALLBACK, status: 'checking' },
			fallbackSyncedAt: LATER,
			seed: readySnapshotAt(EARLIER),
		});
		expect(result.current.status).toBe('ready-to-merge');
	});

	test('a fallback for another pull request than the cached one competes unstamped', () => {
		const { result } = renderLivePullRequest({
			cachedPresentation: { branchSync: null, number: 8, status: 'checking' },
			enabled: false,
			fallback: { ...READY_FALLBACK, status: 'checking' },
			fallbackSyncedAt: LATER,
			seed: readySnapshotAt(EARLIER),
		});
		expect(result.current.status).toBe('ready-to-merge');
	});
});
