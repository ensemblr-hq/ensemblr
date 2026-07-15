import { describe, expect, test } from 'vitest';

import { deriveWorkspacePrPresentation } from '../../src/shared/github-pr-presentation';
import type {
	GithubCheckBucket,
	GithubPullRequestSnapshotWire,
	GithubPullRequestWire,
} from '../../src/shared/ipc/contracts/github';

function pr(overrides: Partial<GithubPullRequestWire>): GithubPullRequestWire {
	return {
		additions: null,
		baseRefName: 'main',
		body: '',
		checks: [],
		comments: [],
		deletions: null,
		deployments: [],
		headRefName: 'feature',
		headRefOid: 'abc123',
		isDraft: false,
		mergeable: 'unknown',
		number: 7,
		state: 'open',
		title: 'A PR',
		updatedAt: '2026-07-15T00:00:00.000Z',
		url: 'https://github.com/o/r/pull/7',
		...overrides,
	};
}

function snapshot(
	pullRequest: GithubPullRequestWire | null,
): GithubPullRequestSnapshotWire {
	return {
		branchSync: null,
		pullRequest,
		syncedAt: '2026-07-15T00:00:00.000Z',
	};
}

function check(
	bucket: GithubCheckBucket,
): GithubPullRequestWire['checks'][number] {
	return { bucket, id: `check-${bucket}`, name: bucket };
}

describe('deriveWorkspacePrPresentation', () => {
	test('returns null when there is no snapshot or no PR', () => {
		expect(deriveWorkspacePrPresentation(null)).toBeNull();
		expect(deriveWorkspacePrPresentation(snapshot(null))).toBeNull();
	});

	test('reports merged and closed straight from PR state', () => {
		expect(
			deriveWorkspacePrPresentation(snapshot(pr({ state: 'merged' }))),
		).toEqual({ number: 7, status: 'merged' });
		expect(
			deriveWorkspacePrPresentation(snapshot(pr({ state: 'closed' }))),
		).toEqual({ number: 7, status: 'closed' });
	});

	test('failing checks or policy blocks win over pending', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshot(pr({ checks: [check('failing'), check('pending')] })),
			),
		).toEqual({ number: 7, status: 'blocked' });
		expect(
			deriveWorkspacePrPresentation(snapshot(pr({ mergeable: 'conflicting' }))),
		).toEqual({ number: 7, status: 'blocked' });
	});

	test('pending checks report as checking', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshot(pr({ checks: [check('pending')] })),
			),
		).toEqual({ number: 7, status: 'checking' });
	});

	test('clean mergeable PR without required review is ready', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshot(pr({ checks: [check('passing')], mergeable: 'mergeable' })),
			),
		).toEqual({ number: 7, status: 'ready' });
	});

	test('draft and review-required PRs stay open', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshot(pr({ isDraft: true, mergeable: 'mergeable' })),
			),
		).toEqual({ number: 7, status: 'open' });
		expect(
			deriveWorkspacePrPresentation(
				snapshot(
					pr({ mergeable: 'mergeable', reviewDecision: 'REVIEW_REQUIRED' }),
				),
			),
		).toEqual({ number: 7, status: 'open' });
	});
});
