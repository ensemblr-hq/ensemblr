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

/** A neutral fallback PR model standing in for the navigation snapshot's state. */
const FALLBACK_PULL_REQUEST: WorkspaceShellModel['pullRequest'] = {
	checks: [],
	comments: [],
	description: [],
	detail: 'Pull request is open.',
	gitStatus: { label: 'Up to date with remote', status: 'open' },
	label: 'PR #7',
	number: 7,
	state: 'open',
	status: 'idle',
	title: 'PR #7',
	todos: [],
};

/** Builds a ready-to-merge PR wire record (open, clean, mergeable, approved). */
function readyPullRequestWire(): GithubPullRequestWire {
	return {
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
		mergeStateStatus: 'CLEAN',
		number: 7,
		reviewDecision: 'APPROVED',
		state: 'open',
		title: 'PR #7',
		updatedAt: '2026-07-15T00:00:00.000Z',
		url: 'https://example.test/pr/7',
	};
}

/** Wraps a snapshot result into the query cache and renders the hook against it. */
function renderLivePullRequest(options: {
	enabled?: boolean;
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
				fallback: FALLBACK_PULL_REQUEST,
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

	test('returns the fallback reference when disabled even if cached', () => {
		const { result } = renderLivePullRequest({
			enabled: false,
			seed: {
				fromCache: true,
				snapshot: {
					branchSync: null,
					pullRequest: readyPullRequestWire(),
					syncedAt: '2026-07-15T00:00:00.000Z',
				},
			},
		});
		expect(result.current).toBe(FALLBACK_PULL_REQUEST);
	});
});
