import { describe, expect, test } from 'vitest';

import {
	diffDocumentFilename,
	renderDiffDocument,
} from '../../src/renderer/lib/workbench/diff-document';
import { REVIEW_CONTEXT_CHAR_LIMIT } from '../../src/renderer/lib/workbench/review-context';

describe('diffDocumentFilename', () => {
	test('names the document after the file the patch came from', () => {
		expect(diffDocumentFilename('src/renderer/app.tsx')).toBe(
			'diff-src-renderer-app-tsx.md',
		);
	});

	test('collapses runs of unsafe characters and trims the edges', () => {
		expect(diffDocumentFilename('/a b//c!!.ts ')).toBe('diff-a-b-c-ts.md');
	});

	test('falls back to a stem when nothing survives sanitizing', () => {
		expect(diffDocumentFilename('///')).toBe('diff-unknown.md');
	});
});

describe('renderDiffDocument', () => {
	const PATCH = ['@@ -1 +1 @@', '-old', '+new'].join('\n');

	test('fences the patch under a heading naming its file', () => {
		const document = renderDiffDocument({
			filePath: 'src/app.ts',
			patch: PATCH,
		});

		expect(document).toContain('# Diff for `src/app.ts`');
		expect(document).toContain('```diff\n@@ -1 +1 @@\n-old\n+new\n```');
	});

	// A thousand-line rewrite must not spend the agent's context before the
	// user's own question is read.
	test('clamps an oversize patch with the review-context marker', () => {
		const document = renderDiffDocument({
			filePath: 'src/app.ts',
			patch: `+${'x'.repeat(REVIEW_CONTEXT_CHAR_LIMIT * 2)}`,
		});

		expect(document.length).toBeLessThan(REVIEW_CONTEXT_CHAR_LIMIT + 200);
		expect(document).toContain('truncated');
	});

	// Clamping the whole document instead of the patch would cut the closing
	// fence off, leaving the agent reading an unterminated code block with the
	// truncation marker inside it.
	test('closes the fence even when the patch was truncated', () => {
		const document = renderDiffDocument({
			filePath: 'src/app.ts',
			patch: `+${'x'.repeat(REVIEW_CONTEXT_CHAR_LIMIT * 2)}`,
		});

		expect(document.trimEnd().endsWith('```')).toBe(true);
		expect(document.split('```')).toHaveLength(3);
		expect(document.indexOf('truncated')).toBeLessThan(
			document.lastIndexOf('```'),
		);
	});
});
