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
		origin: 'user',
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
			body: 'needs a guard',
			createdAt: '2026-07-20T00:00:00.000Z',
			detail: 'needs a guard',
			id: 'c1',
			isResolved: false,
			line: 42,
			origin: 'user',
			path: 'src/lib/trail-map.ts',
			provider: 'local',
		});
	});

	// The preview renders the whole body, so a multi-line note has to reach it
	// intact while the row still gets a single line it can truncate.
	test('carries the full body and summarizes only the row label', () => {
		const summary = localReviewCommentToSummary(
			makeComment({ body: 'needs a guard\n\nsee the null path' }),
		);

		expect(summary.body).toBe('needs a guard\n\nsee the null path');
		expect(summary.detail).toBe('needs a guard');
	});

	// The location has taken the author slot, so authorship needs a field of its
	// own or an agent's note reads exactly like one the user left.
	test('carries authorship through, since the author slot holds the location', () => {
		expect(
			localReviewCommentToSummary(makeComment({ origin: 'agent' })),
		).toMatchObject({ author: 'trail-map.ts:42', origin: 'agent' });
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
