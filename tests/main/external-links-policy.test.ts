import { describe, expect, test } from 'vitest';

import {
	externalNavigationTarget,
	parseAllowedExternalUrl,
} from '../../src/main/app/external-links-policy';

describe('parseAllowedExternalUrl', () => {
	test('accepts http and https URLs', () => {
		expect(parseAllowedExternalUrl('https://github.com/x/y')?.toString()).toBe(
			'https://github.com/x/y',
		);
		expect(parseAllowedExternalUrl('http://example.com/')?.href).toBe(
			'http://example.com/',
		);
	});

	test('rejects non-http(s) schemes', () => {
		expect(parseAllowedExternalUrl('file:///etc/passwd')).toBeNull();
		expect(parseAllowedExternalUrl('javascript:alert(1)')).toBeNull();
		expect(parseAllowedExternalUrl('mailto:a@b.com')).toBeNull();
	});

	test('rejects unparseable input', () => {
		expect(parseAllowedExternalUrl('not a url')).toBeNull();
		expect(parseAllowedExternalUrl('')).toBeNull();
	});
});

describe('externalNavigationTarget', () => {
	const APP_ORIGIN = 'http://localhost:5173';

	test('routes a foreign http(s) origin to the browser', () => {
		expect(
			externalNavigationTarget('https://github.com/x/y', APP_ORIGIN)?.href,
		).toBe('https://github.com/x/y');
	});

	test('keeps same-origin navigation in-app (dev server)', () => {
		expect(
			externalNavigationTarget('http://localhost:5173/workspace/1', APP_ORIGIN),
		).toBeNull();
	});

	test('keeps the production file: bundle in-app', () => {
		expect(
			externalNavigationTarget(
				'file:///Applications/Ensemblr.app/index.html',
				null,
			),
		).toBeNull();
	});

	test('with no app origin (production), foreign http(s) still routes out', () => {
		expect(externalNavigationTarget('https://example.com/', null)?.href).toBe(
			'https://example.com/',
		);
	});

	test('never routes a disallowed scheme out, regardless of origin', () => {
		expect(
			externalNavigationTarget('javascript:alert(1)', APP_ORIGIN),
		).toBeNull();
		expect(
			externalNavigationTarget('file:///etc/passwd', APP_ORIGIN),
		).toBeNull();
	});
});
