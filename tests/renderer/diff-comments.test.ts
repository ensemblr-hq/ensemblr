import { parseDiff } from 'react-diff-view';
import { describe, expect, test } from 'vitest';

import { groupDiffComments } from '../../src/renderer/lib/workbench/diff-comments';
import type { GithubCommentWire } from '../../src/shared/ipc/contracts/github';
import type { ReviewCommentWire } from '../../src/shared/ipc/contracts/review-comments';

const PATCH = `diff --git a/foo.ts b/foo.ts
index 1111111..2222222 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,4 +1,4 @@
 line1
-line2old
+line2new
 line3
 line4
`;

function hunksOf(patch: string) {
	return parseDiff(patch)[0]?.hunks ?? [];
}

function localComment(
	overrides: Partial<ReviewCommentWire>,
): ReviewCommentWire {
	return {
		body: 'local note',
		createdAt: '',
		filePath: 'foo.ts',
		id: 'l1',
		lineNumber: null,
		status: 'open',
		updatedAt: '',
		workspaceId: 'w1',
		...overrides,
	};
}

function githubComment(
	overrides: Partial<GithubCommentWire>,
): GithubCommentWire {
	return {
		author: 'octocat',
		body: 'gh note',
		createdAt: '',
		id: 'g1',
		isResolved: false,
		kind: 'review-comment',
		path: 'foo.ts',
		...overrides,
	};
}

describe('groupDiffComments', () => {
	test('anchors a local comment to its new-side line', () => {
		const grouped = groupDiffComments({
			filePath: 'foo.ts',
			githubComments: [],
			hunks: hunksOf(PATCH),
			localComments: [localComment({ lineNumber: 3 })],
		});
		expect(grouped.unanchored).toHaveLength(0);
		const anchored = [...grouped.byChangeKey.values()].flat();
		expect(anchored).toHaveLength(1);
		expect(anchored[0]?.source).toBe('local');
	});

	test('tags a bot review comment as github-actions and anchors on RIGHT', () => {
		const grouped = groupDiffComments({
			filePath: 'foo.ts',
			githubComments: [githubComment({ isBot: true, line: 2, side: 'RIGHT' })],
			hunks: hunksOf(PATCH),
			localComments: [],
		});
		const anchored = [...grouped.byChangeKey.values()].flat();
		expect(anchored).toHaveLength(1);
		expect(anchored[0]?.source).toBe('github-actions');
	});

	test('flattens replies and keeps them on the same line', () => {
		const grouped = groupDiffComments({
			filePath: 'foo.ts',
			githubComments: [
				githubComment({
					line: 2,
					replies: [githubComment({ author: 'bot', id: 'g2', isBot: true })],
					side: 'RIGHT',
				}),
			],
			hunks: hunksOf(PATCH),
			localComments: [],
		});
		const anchored = [...grouped.byChangeKey.values()].flat();
		expect(anchored).toHaveLength(2);
		expect(anchored.map((comment) => comment.source)).toEqual([
			'github',
			'github-actions',
		]);
	});

	test('leaves a comment without a line unanchored', () => {
		const grouped = groupDiffComments({
			filePath: 'foo.ts',
			githubComments: [githubComment({})],
			hunks: hunksOf(PATCH),
			localComments: [],
		});
		expect(grouped.byChangeKey.size).toBe(0);
		expect(grouped.unanchored).toHaveLength(1);
	});

	test('ignores comments for other files', () => {
		const grouped = groupDiffComments({
			filePath: 'foo.ts',
			githubComments: [githubComment({ line: 2, path: 'other.ts' })],
			hunks: hunksOf(PATCH),
			localComments: [localComment({ filePath: 'other.ts', lineNumber: 2 })],
		});
		expect(grouped.byChangeKey.size).toBe(0);
		expect(grouped.unanchored).toHaveLength(0);
	});
});
