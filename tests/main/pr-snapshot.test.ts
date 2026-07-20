import assert from 'node:assert/strict';
import test from 'node:test';

import { parseReviewThreads } from '../../src/main/github/pr-snapshot.ts';

/** Build the GraphQL `reviewThreads` shape the parser consumes. */
function reviewThreads(nodes: unknown[]): unknown {
	return { nodes };
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
