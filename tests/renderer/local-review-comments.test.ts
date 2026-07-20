import { describe, expect, test } from 'vitest';

import {
	localReviewCommentToSummary,
	selectLocalReviewComments,
} from '../../src/renderer/lib/workbench/local-review-comments';
import type { ReviewCommentWire } from '../../src/shared/ipc/contracts/review-comments';

/**
 * Build a local review comment wire row with sensible defaults.
 * @param overrides - Fields to override on the base row
 * @returns A review comment wire row
 */
function makeComment(
	overrides: Partial<ReviewCommentWire> = {},
): ReviewCommentWire {
	return {
		body: 'needs a guard',
		createdAt: '2026-07-20T00:00:00.000Z',
		filePath: 'src/lib/trail-map.ts',
		id: 'c1',
		lineNumber: 42,
		status: 'open',
		updatedAt: '2026-07-20T00:00:00.000Z',
		workspaceId: 'ws1',
		...overrides,
	};
}

describe('localReviewCommentToSummary', () => {
	test('labels the comment by file basename and line, marked local', () => {
		const summary = localReviewCommentToSummary(makeComment());
		expect(summary).toEqual({
			author: 'trail-map.ts:42',
			detail: 'needs a guard',
			id: 'c1',
			isResolved: false,
			provider: 'local',
		});
	});

	test('file-level comment (no line) drops the line suffix', () => {
		const summary = localReviewCommentToSummary(
			makeComment({ lineNumber: null }),
		);
		expect(summary.author).toBe('trail-map.ts');
	});

	test('resolved status reports as resolved', () => {
		const summary = localReviewCommentToSummary(
			makeComment({ status: 'resolved' }),
		);
		expect(summary.isResolved).toBe(true);
	});
});

describe('selectLocalReviewComments', () => {
	test('keeps open and resolved comments, drops archived', () => {
		const summaries = selectLocalReviewComments([
			makeComment({ id: 'open', status: 'open' }),
			makeComment({ id: 'resolved', status: 'resolved' }),
			makeComment({ id: 'archived', status: 'archived' }),
		]);
		expect(summaries.map((summary) => summary.id)).toEqual([
			'open',
			'resolved',
		]);
	});
});
