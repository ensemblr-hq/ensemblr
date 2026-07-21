import { describe, expect, test } from 'vitest';

import { parseBranchSlug } from '../../src/main/pi-agent/naming/parse-naming-response';

describe('parseBranchSlug', () => {
	test('extracts the labelled branch slug', () => {
		expect(parseBranchSlug('BRANCH: fix-login-redirect')).toBe(
			'fix-login-redirect',
		);
	});

	test('tolerates model preamble and trailing commentary', () => {
		const raw = [
			'Sure, here you go:',
			'',
			'BRANCH: add-dark-mode',
			'',
			'Let me know if you want changes.',
		].join('\n');
		expect(parseBranchSlug(raw)).toBe('add-dark-mode');
	});

	test('kebab-cases a prose branch value', () => {
		expect(parseBranchSlug('BRANCH: Cache Tokens Now!')).toBe(
			'cache-tokens-now',
		);
	});

	test('a missing branch label yields null (triggers retry)', () => {
		expect(parseBranchSlug('TITLE: Only a title here')).toBeNull();
	});

	test('unlabelled or garbage output yields null', () => {
		expect(parseBranchSlug('I cannot help with that.')).toBeNull();
	});

	test('reads the label out of a fenced block', () => {
		expect(parseBranchSlug('```\nBRANCH: rework-tabs\n```')).toBe(
			'rework-tabs',
		);
	});
});
