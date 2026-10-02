/**
 * A review comment reaches the agent as a markdown document rather than a pasted
 * excerpt, so these cover what the document has to carry for the agent to act on
 * it without going back to the provider: who wrote it, where it points, what
 * state the thread is in, and every reply.
 */

import { describe, expect, test } from 'vitest';

import {
	commentAnchorLabel,
	commentDocumentFilename,
	renderCommentDocument,
} from '../../src/renderer/lib/workbench/comment-document';
import type { PullRequestCommentSummary } from '../../src/renderer/types/workbench';

const GITHUB_COMMENT: PullRequestCommentSummary = {
	author: 'octocat',
	body: 'Line one\n\nLine two',
	createdAt: '2026-07-20T09:00:00.000Z',
	detail: 'Line one',
	id: 'c1',
	isResolved: false,
	line: 57,
	path: 'src/app/page.tsx',
	provider: 'github',
	replies: [
		{
			author: 'octocat',
			body: 'Fixed.',
			createdAt: '2026-07-20T10:00:00.000Z',
			id: 'c2',
		},
	],
	url: 'https://github.com/acme/app/pull/9#discussion_r1',
};

describe('renderCommentDocument', () => {
	test('carries the whole body, the anchor, and every reply', () => {
		const document = renderCommentDocument(GITHUB_COMMENT, 9);

		expect(document).toContain('# Review comment on page.tsx:57');
		expect(document).toContain('- **Source:** GitHub review comment');
		expect(document).toContain('- **Author:** octocat');
		expect(document).toContain('- **Location:** src/app/page.tsx:57');
		expect(document).toContain('- **Pull request:** #9');
		expect(document).toContain('- **Thread state:** Unresolved');
		expect(document).toContain('Line one\n\nLine two');
		expect(document).toContain('## Replies (1)');
		expect(document).toContain('**octocat** — 2026-07-20T10:00:00.000Z');
		expect(document).toContain('Fixed.');
	});

	// A bot annotation can never be resolved, so a thread-state row it never earned
	// would tell the agent the feedback is settled when nothing has said so.
	test('a comment with no resolution state prints no thread-state row', () => {
		const document = renderCommentDocument({
			body: 'React Doctor found 2 issues',
			detail: 'React Doctor found 2 issues',
			id: 'c9',
			provider: 'github-actions',
		});

		expect(document).toContain('- **Source:** GitHub Actions comment');
		expect(document).not.toContain('Thread state');
	});

	test('a resolved thread says so', () => {
		const document = renderCommentDocument({
			...GITHUB_COMMENT,
			isResolved: true,
		});

		expect(document).toContain('- **Thread state:** Resolved');
	});

	test('an outdated thread says the diff moved under it', () => {
		const document = renderCommentDocument({
			...GITHUB_COMMENT,
			isOutdated: true,
		});

		expect(document).toContain('- **Outdated:** Yes');
	});

	// A local comment spends its `author` slot on the `path:line` location, so
	// reading authorship off `author` would attribute the note to a filename.
	test('a local comment is attributed by its origin, not its author slot', () => {
		const document = renderCommentDocument({
			author: 'page.tsx:12',
			body: 'Guard this.',
			detail: 'Guard this.',
			id: 'local-1',
			line: 12,
			origin: 'agent',
			path: 'src/app/page.tsx',
			provider: 'local',
		});

		expect(document).toContain('- **Source:** Local review comment');
		expect(document).toContain('- **Author:** Ensemblr agent');
		expect(document).not.toContain('- **Author:** page.tsx:12');
	});

	// The formatter this replaced labelled every non-local comment "GitHub", which
	// would have told the agent a Linear thread lived on a pull request.
	test('a Linear comment is not labelled as GitHub', () => {
		const document = renderCommentDocument({
			author: 'octocat',
			body: 'Ship it.',
			detail: 'Ship it.',
			id: 'lin-1',
			provider: 'linear',
		});

		expect(document).toContain('- **Source:** Linear comment');
		expect(document).not.toContain('GitHub');
	});

	test('a body-less comment renders a placeholder instead of a blank section', () => {
		const document = renderCommentDocument({
			body: '   ',
			detail: '',
			id: 'c3',
			provider: 'github',
		});

		expect(document).toContain('## Comment\n\n_No content._');
	});

	test('an unanchored comment falls back to a bare heading', () => {
		const document = renderCommentDocument({
			body: 'General note.',
			detail: 'General note.',
			id: 'c4',
			provider: 'github',
		});

		expect(document).toContain('# Review comment\n');
		expect(document).not.toContain('- **Location:**');
	});
});

describe('commentDocumentFilename', () => {
	test('names the file after the comment location', () => {
		expect(commentDocumentFilename(GITHUB_COMMENT)).toBe(
			'review-comment-github-page-tsx-57.md',
		);
	});

	test('falls back to the comment id when there is no location', () => {
		expect(
			commentDocumentFilename({
				body: 'x',
				detail: 'x',
				id: 'PRRC_kwDO',
				provider: 'linear',
			}),
		).toBe('review-comment-linear-prrc_kwdo.md');
	});

	test('an id that sanitizes to nothing still yields a valid filename', () => {
		expect(
			commentDocumentFilename({
				body: 'x',
				detail: 'x',
				id: '///',
				provider: 'local',
			}),
		).toBe('review-comment-local-unknown.md');
	});
});

describe('commentAnchorLabel', () => {
	test('reads as the basename and line, not the whole path', () => {
		expect(commentAnchorLabel(GITHUB_COMMENT)).toBe('page.tsx:57');
	});

	test('is empty for a comment that hangs off no line', () => {
		expect(
			commentAnchorLabel({
				author: 'octocat',
				body: 'x',
				detail: 'x',
				id: 'c5',
				provider: 'github',
			}),
		).toBe('');
	});

	test('names the file alone when the comment is file-level', () => {
		expect(
			commentAnchorLabel({
				body: 'x',
				detail: 'x',
				id: 'c6',
				path: 'src/app/page.tsx',
				provider: 'github',
			}),
		).toBe('page.tsx');
	});
});
