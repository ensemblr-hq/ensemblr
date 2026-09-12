import { describe, expect, test } from 'vitest';

import {
	navigationDecision,
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

describe('navigationDecision', () => {
	const DEV = { appDocumentUrl: null, appOrigin: 'http://localhost:5173' };
	const PROD = {
		appDocumentUrl: 'file:///Applications/Ensemblr.app/renderer/index.html',
		appOrigin: null,
	};

	test('routes a foreign http(s) origin to the browser', () => {
		const decision = navigationDecision('https://github.com/x/y', DEV);

		expect(decision.action).toBe('external');
		expect(decision.action === 'external' && decision.url.href).toBe(
			'https://github.com/x/y',
		);
	});

	test('keeps same-origin navigation in-app (dev server)', () => {
		expect(
			navigationDecision('http://localhost:5173/workspace/1', DEV).action,
		).toBe('allow');
	});

	test('keeps the app document in-app, hash routing included', () => {
		expect(navigationDecision(PROD.appDocumentUrl, PROD).action).toBe('allow');
		expect(
			navigationDecision(`${PROD.appDocumentUrl}#/workspace/1`, PROD).action,
		).toBe('allow');
		expect(
			navigationDecision(`${PROD.appDocumentUrl}?x=1#/settings`, PROD).action,
		).toBe('allow');
	});

	test('blocks any other file: document', () => {
		expect(navigationDecision('file:///etc/passwd', PROD).action).toBe('block');
		expect(
			navigationDecision(
				'file:///Applications/Ensemblr.app/renderer/../../../etc/passwd',
				PROD,
			).action,
		).toBe('block');
	});

	test('blocks file:, blob: and data: navigations in dev too', () => {
		expect(navigationDecision('file:///etc/passwd', DEV).action).toBe('block');
		expect(navigationDecision('blob:http://localhost:5173/x', DEV).action).toBe(
			'block',
		);
		expect(
			navigationDecision('data:text/html,<script>1</script>', DEV).action,
		).toBe('block');
	});

	test('blocks javascript: rather than handing it to the browser', () => {
		expect(navigationDecision('javascript:alert(1)', DEV).action).toBe('block');
	});

	test('blocks unparseable input', () => {
		expect(navigationDecision('not a url', DEV).action).toBe('block');
		expect(navigationDecision('', PROD).action).toBe('block');
	});

	test('with no app origin (production), foreign http(s) still routes out', () => {
		const decision = navigationDecision('https://example.com/', PROD);

		expect(decision.action === 'external' && decision.url.href).toBe(
			'https://example.com/',
		);
	});
});
