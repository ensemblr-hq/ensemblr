// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, test } from 'vitest';

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr/query-keys';
import { useLivePullRequestModel } from '../../src/renderer/hooks/workbench-shell/route-layout/use-live-pull-request-model';
import type { WorkspaceShellModel } from '../../src/renderer/types/workbench';
import type {
	GetPullRequestSnapshotResult,
	GithubPullRequestWire,
} from '../../src/shared/ipc/contracts/github';
import { createTestQueryClient } from './support/dom';

const WORKSPACE_ID = 'workspace-1';
const WORKSPACE_CWD = '/repo/feature';
const EARLIER = '2026-07-15T09:00:00.000Z';
const LATER = '2026-07-15T09:30:00.000Z';

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
 * The same fallback as the navigation poll would deliver it once the background
 * sweeper has stamped a presentation — the case where the cached copy can be the
 * fresher of the two.
 */
function stampedFallback(syncedAt: string): WorkspaceShellModel['pullRequest'] {
	return { ...FALLBACK_PULL_REQUEST, status: 'ready-to-merge', syncedAt };
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

/** Wraps a snapshot result into the query cache and renders the hook against it. */
function renderLivePullRequest(options: {
	enabled?: boolean;
	fallback?: WorkspaceShellModel['pullRequest'];
	seed?: GetPullRequestSnapshotResult;
}) {
	const client = createTestQueryClient();
	if (options.seed) {
		client.setQueryData(
			ensemblrQueryKeys.pullRequestSnapshot(WORKSPACE_ID),
			options.seed,
		);
	}
	const wrapper = ({ children }: PropsWithChildren) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	return renderHook(
		() =>
			useLivePullRequestModel({
				changeSummary: { additions: 0, deletions: 0, files: 0 },
				enabled: options.enabled ?? true,
				fallback: options.fallback ?? FALLBACK_PULL_REQUEST,
				workspaceCwd: WORKSPACE_CWD,
				workspaceId: WORKSPACE_ID,
			}),
		{ wrapper },
	);
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
			fallback: stampedFallback(LATER),
			seed: checkingSnapshotAt(EARLIER),
		});
		expect(result.current.status).toBe('ready-to-merge');
		expect(result.current.syncedAt).toBe(LATER);
	});

	test('a fresher cached verdict keeps the live snapshot body', () => {
		const { result } = renderLivePullRequest({
			fallback: stampedFallback(LATER),
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
			fallback: stampedFallback(LATER),
			seed: conflictingSnapshotAt(EARLIER),
		});
		expect(result.current.status).toBe('ready-to-merge');
		expect(result.current.isConflicting).toBe(false);
	});

	test('a fresher cached verdict still blocked carries the conflict through', () => {
		const { result } = renderLivePullRequest({
			fallback: { ...stampedFallback(LATER), status: 'blocked' },
			seed: conflictingSnapshotAt(EARLIER),
		});
		expect(result.current.status).toBe('blocked');
		expect(result.current.isConflicting).toBe(true);
	});

	test('a fresher cached verdict for another PR replaces the model outright', () => {
		const cached = { ...stampedFallback(LATER), number: 43 };
		const { result } = renderLivePullRequest({
			fallback: cached,
			seed: checkingSnapshotAt(EARLIER),
		});
		expect(result.current).toBe(cached);
		expect(result.current.url).toBeUndefined();
	});

	test('a failed refresh with no snapshot never unseats a cached pull request', () => {
		const { result } = renderLivePullRequest({
			fallback: stampedFallback(LATER),
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
			fallback: stampedFallback(EARLIER),
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
			fallback: { ...stampedFallback(EARLIER), status: 'checking' },
			seed: readySnapshotAt(LATER),
		});
		expect(result.current.status).toBe('ready-to-merge');
	});

	test('a disabled row falls back once the cached presentation overtakes it', () => {
		const { result } = renderLivePullRequest({
			enabled: false,
			fallback: stampedFallback(LATER),
			seed: checkingSnapshotAt(EARLIER),
		});
		expect(result.current.status).toBe('ready-to-merge');
	});
});
