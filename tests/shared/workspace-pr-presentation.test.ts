import { describe, expect, test } from 'vitest';

import {
	deriveWorkspacePrPresentation,
	isFresherPrObservation,
	parseWorkspacePrPresentation,
} from '../../src/shared/github-pr-presentation';
import type {
	GitBranchSyncWire,
	GithubCheckBucket,
	GithubPullRequestSnapshotWire,
	GithubPullRequestWire,
} from '../../src/shared/ipc/contracts/github';
import type { WorkspacePrPresentation } from '../../src/shared/ipc/contracts/repository-navigation';

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

function syncedBranch(
	overrides: Partial<GitBranchSyncWire> = {},
): GitBranchSyncWire {
	return {
		ahead: 0,
		behind: 0,
		branchName: 'feature',
		hasUpstream: true,
		headSha: 'abc123',
		...overrides,
	};
}

function snapshotOn(
	pullRequest: GithubPullRequestWire,
	branchSync: GithubPullRequestSnapshotWire['branchSync'],
): GithubPullRequestSnapshotWire {
	return { branchSync, pullRequest, syncedAt: SYNCED_AT };
}

/**
 * The presentation a snapshot of PR #7 should derive to. `branchSync` rides
 * along verbatim so a sidebar row can report unpushed commits without a second
 * git query, which is why every case asserts the one it was given back.
 */
function presentationOf(
	status: WorkspacePrPresentation['status'],
	branchSync: GitBranchSyncWire | null = null,
): WorkspacePrPresentation {
	return { branchSync, number: 7, status, syncedAt: SYNCED_AT };
}

describe('deriveWorkspacePrPresentation', () => {
	test('returns null when there is no snapshot or no PR', () => {
		expect(deriveWorkspacePrPresentation(null)).toBeNull();
		expect(deriveWorkspacePrPresentation(snapshot(null))).toBeNull();
	});

	test('reports merged and closed straight from PR state', () => {
		expect(
			deriveWorkspacePrPresentation(snapshot(pr({ state: 'merged' }))),
		).toEqual(presentationOf('merged'));
		expect(
			deriveWorkspacePrPresentation(snapshot(pr({ state: 'closed' }))),
		).toEqual(presentationOf('closed'));
	});

	test('failing checks or policy blocks win over pending', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshot(pr({ checks: [check('failing'), check('pending')] })),
			),
		).toEqual(presentationOf('blocked'));
		expect(
			deriveWorkspacePrPresentation(snapshot(pr({ mergeable: 'conflicting' }))),
		).toEqual(presentationOf('blocked'));
	});

	test('pending checks report as checking', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshot(pr({ checks: [check('pending')] })),
			),
		).toEqual(presentationOf('checking'));
	});

	test('clean mergeable PR without required review is ready', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshot(pr({ checks: [check('passing')], mergeable: 'mergeable' })),
			),
		).toEqual(presentationOf('ready'));
	});

	test('draft and review-required PRs stay open', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshot(pr({ isDraft: true, mergeable: 'mergeable' })),
			),
		).toEqual(presentationOf('open'));
		expect(
			deriveWorkspacePrPresentation(
				snapshot(
					pr({ mergeable: 'mergeable', reviewDecision: 'REVIEW_REQUIRED' }),
				),
			),
		).toEqual(presentationOf('open'));
	});

	test('reports checks running while the PR head lags the pushed branch tip', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshotOn(
					pr({
						checks: [check('passing')],
						headCommitKnownLocally: true,
						mergeable: 'mergeable',
					}),
					syncedBranch({ headSha: 'def456' }),
				),
			),
		).toEqual(presentationOf('checking', syncedBranch({ headSha: 'def456' })));
	});

	test('leaves a PR head this repository never had to GitHub', () => {
		// The remote branch moved on without us — a suggestion committed from
		// GitHub's UI, "Update branch", a teammate's push. Nothing fetches this
		// branch, so `ahead`/`behind` still read level against a stale tracking
		// ref and only the missing commit tells the two cases apart.
		expect(
			deriveWorkspacePrPresentation(
				snapshotOn(
					pr({
						checks: [check('passing')],
						headCommitKnownLocally: false,
						mergeable: 'mergeable',
					}),
					syncedBranch({ headSha: 'def456' }),
				),
			),
		).toEqual(presentationOf('ready', syncedBranch({ headSha: 'def456' })));
	});

	test('leaves a PR to GitHub when git could not say whether it has the commit', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshotOn(
					pr({ checks: [check('passing')], mergeable: 'mergeable' }),
					syncedBranch({ headSha: 'def456' }),
				),
			),
		).toEqual(presentationOf('ready', syncedBranch({ headSha: 'def456' })));
	});

	test('reports ready once the PR head is the branch tip', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshotOn(
					pr({
						checks: [check('passing')],
						headCommitKnownLocally: true,
						mergeable: 'mergeable',
					}),
					syncedBranch(),
				),
			),
		).toEqual(presentationOf('ready', syncedBranch()));
	});

	test('leaves a branch that is not level with its upstream to GitHub', () => {
		const readyPr = pr({
			checks: [check('passing')],
			headCommitKnownLocally: true,
			mergeable: 'mergeable',
		});
		for (const branchSync of [
			syncedBranch({ ahead: 1, headSha: 'def456' }),
			syncedBranch({ behind: 1, headSha: 'def456' }),
			syncedBranch({ hasUpstream: false, headSha: 'def456' }),
		]) {
			expect(
				deriveWorkspacePrPresentation(snapshotOn(readyPr, branchSync)),
			).toEqual(presentationOf('ready', branchSync));
		}
	});

	test('a snapshot cached without a branch tip keeps its verdict', () => {
		const { headSha: _dropped, ...withoutTip } = syncedBranch();
		expect(
			deriveWorkspacePrPresentation(
				snapshotOn(
					pr({
						checks: [check('passing')],
						headCommitKnownLocally: true,
						mergeable: 'mergeable',
					}),
					withoutTip,
				),
			),
		).toEqual(presentationOf('ready', withoutTip));
	});

	test('an empty rollup on a PR that just had checks reads as checking', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshot(
					pr({
						checksLastObservedAt: '2026-07-14T23:59:00.000Z',
						mergeable: 'mergeable',
						mergeStateStatus: 'CLEAN',
					}),
				),
			),
		).toEqual(presentationOf('checking'));
	});

	test('an empty rollup goes ready once the registration grace lapses', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshot(
					pr({
						checksLastObservedAt: '2026-07-14T23:58:00.000Z',
						mergeable: 'mergeable',
						mergeStateStatus: 'CLEAN',
					}),
				),
			),
		).toEqual(presentationOf('ready'));
	});

	test('a repository that has never reported a check stays ready', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshot(pr({ mergeable: 'mergeable', mergeStateStatus: 'CLEAN' })),
			),
		).toEqual(presentationOf('ready'));
	});

	test('a rollup that came back keeps its own verdict inside the grace', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshot(
					pr({
						checks: [check('passing')],
						checksLastObservedAt: '2026-07-14T23:59:00.000Z',
						mergeable: 'mergeable',
					}),
				),
			),
		).toEqual(presentationOf('ready'));
	});

	test('a non-passing merge state reads as checks still running', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshot(
					pr({
						checks: [check('passing')],
						mergeable: 'mergeable',
						mergeStateStatus: 'UNSTABLE',
					}),
				),
			),
		).toEqual(presentationOf('checking'));
	});

	test('a head GitHub reports as out of date is blocked', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshot(
					pr({
						checks: [check('passing')],
						mergeable: 'mergeable',
						mergeStateStatus: 'BEHIND',
					}),
				),
			),
		).toEqual(presentationOf('blocked'));
	});

	test('a failing check outranks a non-passing merge state', () => {
		expect(
			deriveWorkspacePrPresentation(
				snapshot(
					pr({
						checks: [check('failing')],
						mergeable: 'mergeable',
						mergeStateStatus: 'UNSTABLE',
					}),
				),
			),
		).toEqual(presentationOf('blocked'));
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

describe('parseWorkspacePrPresentation', () => {
	test('returns null for an absent, malformed, or unstamped snapshot', () => {
		expect(parseWorkspacePrPresentation(null)).toBeNull();
		expect(parseWorkspacePrPresentation('{ not json')).toBeNull();
		expect(
			parseWorkspacePrPresentation(
				JSON.stringify({ branchSync: null, pullRequest: pr({}) }),
			),
		).toBeNull();
	});

	test('derives the presentation from a stored snapshot column', () => {
		expect(
			parseWorkspacePrPresentation(
				JSON.stringify(snapshot(pr({ checks: [check('pending')] }))),
			),
		).toEqual(presentationOf('checking'));
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
