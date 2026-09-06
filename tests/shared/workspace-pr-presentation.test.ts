import { describe, expect, test } from 'vitest';

import {
	deriveWorkspacePrPresentation,
	isFresherPrObservation,
} from '../../src/shared/github-pr-presentation';
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

const SYNCED_AT = '2026-07-15T00:00:00.000Z';

function snapshot(
	pullRequest: GithubPullRequestWire | null,
): GithubPullRequestSnapshotWire {
	return {
		branchSync: null,
		pullRequest,
		syncedAt: SYNCED_AT,
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
		).toEqual({ number: 7, syncedAt: SYNCED_AT, status: 'merged' });
		expect(
			deriveWorkspacePrPresentation(snapshot(pr({ state: 'closed' }))),
		).toEqual({ number: 7, syncedAt: SYNCED_AT, status: 'closed' });
	});

	test('failing checks or policy blocks win over pending', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshot(pr({ checks: [check('failing'), check('pending')] })),
			),
		).toEqual({ number: 7, syncedAt: SYNCED_AT, status: 'blocked' });
		expect(
			deriveWorkspacePrPresentation(snapshot(pr({ mergeable: 'conflicting' }))),
		).toEqual({ number: 7, syncedAt: SYNCED_AT, status: 'blocked' });
	});

	test('pending checks report as checking', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshot(pr({ checks: [check('pending')] })),
			),
		).toEqual({ number: 7, syncedAt: SYNCED_AT, status: 'checking' });
	});

	test('clean mergeable PR without required review is ready', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshot(pr({ checks: [check('passing')], mergeable: 'mergeable' })),
			),
		).toEqual({ number: 7, syncedAt: SYNCED_AT, status: 'ready' });
	});

	test('draft and review-required PRs stay open', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshot(pr({ isDraft: true, mergeable: 'mergeable' })),
			),
		).toEqual({ number: 7, syncedAt: SYNCED_AT, status: 'open' });
		expect(
			deriveWorkspacePrPresentation(
				snapshot(
					pr({ mergeable: 'mergeable', reviewDecision: 'REVIEW_REQUIRED' }),
				),
			),
		).toEqual({ number: 7, syncedAt: SYNCED_AT, status: 'open' });
	});

	test('stamps the presentation with the snapshot it was derived from', () => {
		expect(
			deriveWorkspacePrPresentation({
				branchSync: null,
				pullRequest: pr({}),
				syncedAt: '2026-07-15T09:30:00.000Z',
			})?.syncedAt,
		).toBe('2026-07-15T09:30:00.000Z');
	});
});

describe('isFresherPrObservation', () => {
	const EARLIER = '2026-07-15T09:00:00.000Z';
	const LATER = '2026-07-15T09:30:00.000Z';

	test('a later observation supersedes an earlier one', () => {
		expect(isFresherPrObservation(LATER, EARLIER)).toBe(true);
	});

	test('an earlier observation never supersedes a later one', () => {
		expect(isFresherPrObservation(EARLIER, LATER)).toBe(false);
	});

	test('an equal stamp supersedes, so a same-instant rewrite still lands', () => {
		expect(isFresherPrObservation(EARLIER, EARLIER)).toBe(true);
	});

	test('there is nothing to protect when the incumbent has no stamp', () => {
		expect(isFresherPrObservation(EARLIER, undefined)).toBe(true);
	});

	test('an unstamped candidate cannot unseat a stamped incumbent', () => {
		expect(isFresherPrObservation(undefined, LATER)).toBe(false);
		expect(isFresherPrObservation('not-a-date', LATER)).toBe(false);
	});

	test('an unreadable incumbent stamp still yields to the candidate', () => {
		expect(isFresherPrObservation(EARLIER, 'not-a-date')).toBe(true);
		expect(isFresherPrObservation(undefined, undefined)).toBe(true);
	});
});
