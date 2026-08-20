import assert from 'node:assert/strict';
import test from 'node:test';

import {
	parseReviewThreads,
	retainKnownMergeability,
} from '../../src/main/github/pr-snapshot.ts';
import type {
	GithubPullRequestSnapshotWire,
	GithubPullRequestWire,
} from '../../src/shared/ipc/contracts/github.ts';

/** Build the GraphQL `reviewThreads` shape the parser consumes. */
function reviewThreads(nodes: unknown[]): unknown {
	return { nodes };
}

/** Build a snapshot around one pull request's mergeability fields. */
function snapshot(
	pullRequest: Partial<GithubPullRequestWire> | null,
	syncedAt = '2026-08-20T11:41:00.000Z',
): GithubPullRequestSnapshotWire {
	return {
		branchSync: null,
		pullRequest: pullRequest
			? ({
					additions: 0,
					baseRefName: 'master',
					body: '',
					checks: [],
					comments: [],
					deletions: 0,
					deployments: [],
					headRefName: 'feature',
					headRefOid: 'abc123',
					isDraft: false,
					mergeable: 'mergeable',
					mergeableSyncedAt: syncedAt,
					number: 327,
					state: 'open',
					title: 'PR #327',
					updatedAt: syncedAt,
					url: 'https://example.test/pr/327',
					...pullRequest,
				} as GithubPullRequestWire)
			: null,
		syncedAt,
	};
}

test('parseReviewThreads anchors a thread with side and outdated state', () => {
	const [comment] = parseReviewThreads(
		reviewThreads([
			{
				diffSide: 'RIGHT',
				id: 'THREAD_1',
				isOutdated: true,
				isResolved: false,
				line: 12,
				path: 'src/foo.ts',
				startLine: 10,
				comments: {
					nodes: [
						{
							author: { __typename: 'User', login: 'octocat' },
							body: 'looks off',
							createdAt: '2026-07-20T00:00:00Z',
							id: 'C1',
							url: 'https://example/1',
						},
					],
				},
			},
		]),
	);

	assert.equal(comment.side, 'RIGHT');
	assert.equal(comment.line, 12);
	assert.equal(comment.startLine, 10);
	assert.equal(comment.isOutdated, true);
	assert.equal(comment.threadId, 'THREAD_1');
	assert.equal(comment.isBot, false);
	assert.equal(comment.path, 'src/foo.ts');
});

test('parseReviewThreads flags bot authors and keeps replies', () => {
	const [comment] = parseReviewThreads(
		reviewThreads([
			{
				diffSide: 'LEFT',
				id: 'THREAD_2',
				isResolved: true,
				line: 3,
				path: 'src/bar.ts',
				comments: {
					nodes: [
						{
							author: { __typename: 'Bot', login: 'github-actions[bot]' },
							body: 'coverage dropped',
							id: 'B1',
						},
						{
							author: { __typename: 'User', login: 'maintainer' },
							body: 'thanks, fixing',
							id: 'R1',
						},
					],
				},
			},
		]),
	);

	assert.equal(comment.isBot, true);
	assert.equal(comment.side, 'LEFT');
	assert.equal(comment.isResolved, true);
	assert.equal(comment.replies?.length, 1);
	assert.equal(comment.replies?.[0]?.author, 'maintainer');
});

test('parseReviewThreads detects the [bot] login suffix without a typename', () => {
	const [comment] = parseReviewThreads(
		reviewThreads([
			{
				id: 'THREAD_3',
				comments: {
					nodes: [
						{ author: { login: 'dependabot[bot]' }, body: 'bump', id: 'D1' },
					],
				},
			},
		]),
	);

	assert.equal(comment.isBot, true);
});

test('parseReviewThreads returns an empty list for malformed input', () => {
	assert.deepEqual(parseReviewThreads(null), []);
	assert.deepEqual(parseReviewThreads({ nodes: [{}] }), []);
});

test('retainKnownMergeability keeps the computed verdict when gh answers unknown', () => {
	const merged = retainKnownMergeability(
		snapshot({ mergeable: 'unknown', mergeStateStatus: 'UNKNOWN' }),
		snapshot({ mergeable: 'mergeable', mergeStateStatus: 'CLEAN' }),
	);

	assert.equal(merged.pullRequest?.mergeable, 'mergeable');
	assert.equal(merged.pullRequest?.mergeStateStatus, 'CLEAN');
});

test('retainKnownMergeability stamps when GitHub computed a fresh verdict', () => {
	const merged = retainKnownMergeability(
		snapshot({ mergeable: 'mergeable' }, '2026-08-20T12:00:00.000Z'),
		null,
	);

	assert.equal(
		merged.pullRequest?.mergeableSyncedAt,
		'2026-08-20T12:00:00.000Z',
	);
});

test('retainKnownMergeability preserves the original stamp across a carry', () => {
	const merged = retainKnownMergeability(
		snapshot({ mergeable: 'unknown' }, '2026-08-20T11:41:30.000Z'),
		snapshot({ mergeable: 'mergeable' }, '2026-08-20T11:41:00.000Z'),
	);

	assert.equal(merged.pullRequest?.mergeable, 'mergeable');
	assert.equal(
		merged.pullRequest?.mergeableSyncedAt,
		'2026-08-20T11:41:00.000Z',
	);
});

test('retainKnownMergeability stops carrying once the retention window lapses', () => {
	const carried = snapshot({ mergeable: 'mergeable' });
	const beforeWindow = retainKnownMergeability(
		snapshot({ mergeable: 'unknown' }, '2026-08-20T11:42:59.000Z'),
		carried,
	);
	const afterWindow = retainKnownMergeability(
		snapshot({ mergeable: 'unknown' }, '2026-08-20T11:43:00.000Z'),
		carried,
	);

	assert.equal(beforeWindow.pullRequest?.mergeable, 'mergeable');
	assert.equal(afterWindow.pullRequest?.mergeable, 'unknown');
});

test('retainKnownMergeability refuses a cached verdict GitHub never stamped', () => {
	const unstamped = snapshot({ mergeable: 'mergeable' });
	const merged = retainKnownMergeability(snapshot({ mergeable: 'unknown' }), {
		...unstamped,
		pullRequest: unstamped.pullRequest
			? { ...unstamped.pullRequest, mergeableSyncedAt: undefined }
			: null,
	});

	assert.equal(merged.pullRequest?.mergeable, 'unknown');
});

test('retainKnownMergeability keeps a merge state the fetch actually resolved', () => {
	const merged = retainKnownMergeability(
		snapshot({ mergeable: 'unknown', mergeStateStatus: 'BLOCKED' }),
		snapshot({ mergeable: 'mergeable', mergeStateStatus: 'CLEAN' }),
	);

	assert.equal(merged.pullRequest?.mergeable, 'mergeable');
	assert.equal(merged.pullRequest?.mergeStateStatus, 'BLOCKED');
});

test('retainKnownMergeability carries the merge state only when gh omits one', () => {
	const fetched = snapshot({ mergeable: 'unknown' });
	const merged = retainKnownMergeability(
		{
			...fetched,
			pullRequest: fetched.pullRequest
				? { ...fetched.pullRequest, mergeStateStatus: undefined }
				: null,
		},
		snapshot({ mergeable: 'mergeable', mergeStateStatus: 'CLEAN' }),
	);

	assert.equal(merged.pullRequest?.mergeStateStatus, 'CLEAN');
});

test('retainKnownMergeability drops the cached verdict once the head moves', () => {
	const merged = retainKnownMergeability(
		snapshot({
			headRefOid: 'def456',
			mergeable: 'unknown',
			mergeStateStatus: 'UNKNOWN',
		}),
		snapshot({ mergeable: 'mergeable', mergeStateStatus: 'CLEAN' }),
	);

	assert.equal(merged.pullRequest?.mergeable, 'unknown');
	assert.equal(merged.pullRequest?.mergeStateStatus, 'UNKNOWN');
});

test('retainKnownMergeability never overwrites a freshly computed verdict', () => {
	const merged = retainKnownMergeability(
		snapshot({ mergeable: 'conflicting', mergeStateStatus: 'DIRTY' }),
		snapshot({ mergeable: 'mergeable', mergeStateStatus: 'CLEAN' }),
	);

	assert.equal(merged.pullRequest?.mergeable, 'conflicting');
	assert.equal(merged.pullRequest?.mergeStateStatus, 'DIRTY');
});

test('retainKnownMergeability passes through when there is nothing cached', () => {
	const fetched = snapshot({ mergeable: 'unknown' });

	assert.equal(retainKnownMergeability(fetched, null), fetched);
	assert.equal(retainKnownMergeability(fetched, snapshot(null)), fetched);
});
