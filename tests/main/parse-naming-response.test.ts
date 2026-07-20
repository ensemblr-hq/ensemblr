import { describe, expect, test } from 'vitest';

import { parseNamingResponse } from '../../src/main/pi-agent/naming/parse-naming-response';

const BOTH = { wantBranch: true, wantTitle: true } as const;

describe('parseNamingResponse', () => {
	test('extracts both labelled fields', () => {
		expect(
			parseNamingResponse(
				'TITLE: Fix login redirect\nBRANCH: fix-login-redirect',
				BOTH,
			),
		).toEqual({
			branchSlug: 'fix-login-redirect',
			title: 'Fix login redirect',
		});
	});

	test('tolerates model preamble and trailing commentary', () => {
		const raw = [
			'Sure, here you go:',
			'',
			'TITLE: Add dark mode',
			'BRANCH: add-dark-mode',
			'',
			'Let me know if you want changes.',
		].join('\n');
		expect(parseNamingResponse(raw, BOTH)).toEqual({
			branchSlug: 'add-dark-mode',
			title: 'Add dark mode',
		});
	});

	test('sanitizes each field independently (branch kebab-cases a prose value)', () => {
		expect(
			parseNamingResponse(
				'TITLE: Cache tokens\nBRANCH: Cache Tokens Now!',
				BOTH,
			),
		).toEqual({ branchSlug: 'cache-tokens-now', title: 'Cache tokens' });
	});

	test('a missing labelled field is null, the present one survives', () => {
		expect(parseNamingResponse('TITLE: Only a title here', BOTH)).toEqual({
			branchSlug: null,
			title: 'Only a title here',
		});
	});

	test('only returns requested fields', () => {
		expect(
			parseNamingResponse('TITLE: Ignored\nBRANCH: keep-me', {
				wantBranch: true,
				wantTitle: false,
			}),
		).toEqual({ branchSlug: 'keep-me', title: null });
	});

	test('unlabelled or garbage output yields all nulls (triggers retry)', () => {
		expect(parseNamingResponse('I cannot help with that.', BOTH)).toEqual({
			branchSlug: null,
			title: null,
		});
	});

	test('reads labels out of a fenced block', () => {
		const raw = '```\nTITLE: Rework tabs\nBRANCH: rework-tabs\n```';
		expect(parseNamingResponse(raw, BOTH)).toEqual({
			branchSlug: 'rework-tabs',
			title: 'Rework tabs',
		});
	});
});
