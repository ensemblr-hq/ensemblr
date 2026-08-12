import { describe, expect, test } from 'vitest';

import {
	describeComment,
	formatCommentLocation,
	stripCommentMetadata,
	summarizeCommentBody,
} from '../../src/renderer/lib/workbench/comment-body';

describe('stripCommentMetadata', () => {
	test('drops the base64 state blob Vercel hides in a link definition', () => {
		const body = [
			'[vc]: #Un4Opd4tSVroIz2CPCZ3Oikl6ACPaRKqIX4FhWyWCdo=:eyJpc01vbm9yZXBvIjp0cnVl',
			'',
			'**Preview deployment ready**',
		].join('\n');

		expect(stripCommentMetadata(body)).toBe('**Preview deployment ready**');
	});

	test('drops HTML comment markers bots use to tag their own comments', () => {
		const body =
			'<!-- react-doctor:summary -->\n**React Doctor** found 2 issues';

		expect(stripCommentMetadata(body)).toBe('**React Doctor** found 2 issues');
	});

	test('drops a marker spanning several lines', () => {
		const body = '<!--\nlinear-linkback\nid: ENG-106\n-->\nLinked to ENG-106';

		expect(stripCommentMetadata(body)).toBe('Linked to ENG-106');
	});

	test('keeps a short in-page anchor definition, which is real content', () => {
		const body = '[docs]: #installation\n\nSee [docs].';

		expect(stripCommentMetadata(body)).toContain('[docs]: #installation');
	});

	test('collapses the blank-line runs stripping leaves behind', () => {
		const body = 'First\n\n<!-- marker -->\n\n\nSecond';

		expect(stripCommentMetadata(body)).toBe('First\n\nSecond');
	});
});

describe('summarizeCommentBody', () => {
	test('skips a leading blank line instead of reporting an empty summary', () => {
		expect(summarizeCommentBody('\n\nMissing a null guard here')).toBe(
			'Missing a null guard here',
		);
	});

	test('unwraps a heading into plain prose', () => {
		expect(summarizeCommentBody('## Build failed\n\nSee the log.')).toBe(
			'Build failed',
		);
	});

	test('unwraps emphasis, list markers, and quote markers', () => {
		expect(summarizeCommentBody('> - **Warning:** `useMemo` is missing')).toBe(
			'Warning: useMemo is missing',
		);
	});

	test('reads through an HTML wrapper to the summary text inside', () => {
		const body = '<details>\n<summary>Preview deployment</summary>\n\nBody';

		expect(summarizeCommentBody(body)).toBe('Preview deployment');
	});

	test('skips horizontal rules and table dividers', () => {
		expect(summarizeCommentBody('---\n| --- | --- |\nReal text')).toBe(
			'Real text',
		);
	});

	test('skips a multi-column divider written without a leading pipe', () => {
		expect(summarizeCommentBody(':--- | ---: | :---:\nReal text')).toBe(
			'Real text',
		);
	});

	test('keeps a line of divider characters that is missing its pipe', () => {
		expect(summarizeCommentBody(':--- ---: :---:')).toBe(':--- ---: :---:');
	});

	// Comment bodies are third-party input: GitHub allows 65,536 characters, and
	// an ambiguous divider pattern turns one long line of them into seconds of
	// blocked renderer.
	test('a pathological line of divider characters stays linear', () => {
		const started = performance.now();

		summarizeCommentBody(`${'|'.repeat(50_000)}x`);

		expect(performance.now() - started).toBeLessThan(100);
	});

	test('truncates a very long first line', () => {
		const summary = summarizeCommentBody('x'.repeat(400));

		expect(summary).toHaveLength(201);
		expect(summary.endsWith('…')).toBe(true);
	});

	test('reports empty for a body that is nothing but metadata', () => {
		expect(summarizeCommentBody('<!-- marker -->')).toBe('');
	});
});

describe('formatCommentLocation', () => {
	test('joins path and line', () => {
		expect(formatCommentLocation('src/app/page.tsx', 57)).toBe(
			'src/app/page.tsx:57',
		);
	});

	test('drops the suffix for a file-level comment', () => {
		expect(formatCommentLocation('src/app/page.tsx')).toBe('src/app/page.tsx');
	});

	test('reports empty when there is no path', () => {
		expect(formatCommentLocation(undefined, 57)).toBe('');
	});
});

describe('describeComment', () => {
	test('prefers the body prose over the diff location', () => {
		expect(
			describeComment({
				body: 'Prefer a nullish check',
				line: 57,
				path: 'src/app/page.tsx',
			}),
		).toBe('Prefer a nullish check');
	});

	test('falls back to the first reply that has prose', () => {
		expect(
			describeComment({
				body: '',
				replies: [{ body: '' }, { body: 'Fixed in 4b1108b' }],
			}),
		).toBe('Fixed in 4b1108b');
	});

	test('falls back to the diff location when nothing has prose', () => {
		expect(
			describeComment({ body: '', line: 57, path: 'src/app/page.tsx' }),
		).toBe('src/app/page.tsx:57');
	});

	test('falls back to a placeholder when there is nothing at all', () => {
		expect(describeComment({ body: '' })).toBe('No description');
	});
});
