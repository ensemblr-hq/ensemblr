import { describe, expect, test } from 'vitest';

import {
	APP_ORIGIN,
	APP_RENDERER_ENTRY_URL,
} from '../../src/main/app/app-bundle';
import {
	navigationDecision,
	parseAllowedExternalUrl,
	subframeNavigationDecision,
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
	const DEV = 'http://localhost:5173';
	const PROD = APP_ORIGIN;
	const PROD_ENTRY = APP_RENDERER_ENTRY_URL;

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
		expect(navigationDecision(PROD_ENTRY, PROD).action).toBe('allow');
		expect(navigationDecision(`${PROD_ENTRY}#/workspace/1`, PROD).action).toBe(
			'allow',
		);
		expect(navigationDecision(`${PROD_ENTRY}?x=1#/settings`, PROD).action).toBe(
			'allow',
		);
	});

	// The whole point of the move off `file:`: with the fuse closed the renderer
	// cannot read one, and the policy refuses to navigate to one either.
	test('blocks every file: document, packaged included', () => {
		expect(navigationDecision('file:///etc/passwd', PROD).action).toBe('block');
		expect(
			navigationDecision(
				'file:///Applications/Ensemblr.app/renderer/index.html',
				PROD,
			).action,
		).toBe('block');
	});

	// Deliberately wider than the `file:` policy it replaces, which admitted only
	// the entry URL: the packaged renderer now has a real origin, so the whole of
	// it is in-app exactly as the dev server's whole origin always was. Nothing
	// outside the built bundle is reachable on it — `bundleFilePath` is what
	// bounds that, not this.
	test('keeps any path on the app origin in-app', () => {
		for (const path of ['/', '/assets/index-a1b2c3.js', '/anything']) {
			expect(navigationDecision(`${PROD}${path}`, PROD).action).toBe('allow');
		}
	});

	// `app://bundle` is the only host this scheme serves, and a sibling host is
	// a different origin rather than a path inside the bundle.
	test('blocks another host on the app scheme', () => {
		expect(navigationDecision('app://evil/index.html', PROD).action).toBe(
			'block',
		);
		expect(navigationDecision('app://bundle.evil/x', PROD).action).toBe(
			'block',
		);
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

	test('a packaged build still routes foreign http(s) out', () => {
		const decision = navigationDecision('https://example.com/', PROD);

		expect(decision.action === 'external' && decision.url.href).toBe(
			'https://example.com/',
		);
	});
});

// The file preview shows a PDF by handing <embed> a blob the app minted, after
// which Chromium instantiates its own viewer in a nested frame. Both steps are
// frame navigations that the top-level policy refuses, so the subframe handler
// carries the two exceptions — and only those two.
describe('subframeNavigationDecision', () => {
	const DEV = 'http://localhost:5173';
	const PACKAGED = APP_ORIGIN;

	test("admits the app's own blob, from either serving mode", () => {
		expect(
			subframeNavigationDecision('blob:http://localhost:5173/abc', DEV).action,
		).toBe('allow');
		expect(
			subframeNavigationDecision(`blob:${APP_ORIGIN}/abc`, PACKAGED).action,
		).toBe('allow');
	});

	test("admits Chromium's PDF viewer", () => {
		for (const appDocument of [DEV, PACKAGED]) {
			expect(
				subframeNavigationDecision(
					'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html',
					appDocument,
				).action,
			).toBe('allow');
		}
	});

	test('refuses a blob another origin minted', () => {
		expect(
			subframeNavigationDecision('blob:http://evil.test/abc', DEV).action,
		).toBe('block');
		expect(
			subframeNavigationDecision('blob:http://localhost:5173/abc', PACKAGED)
				.action,
		).toBe('block');
		expect(
			subframeNavigationDecision('blob:file:///abc', PACKAGED).action,
		).toBe('block');
		expect(
			subframeNavigationDecision(`blob:app://evil/abc`, PACKAGED).action,
		).toBe('block');
	});

	test('refuses any other extension id', () => {
		expect(
			subframeNavigationDecision(
				'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/x.html',
				DEV,
			).action,
		).toBe('block');
	});

	test('leaves every other subframe destination to the top-level policy', () => {
		expect(subframeNavigationDecision('file:///etc/passwd', DEV).action).toBe(
			'block',
		);
		expect(subframeNavigationDecision('javascript:alert(1)', DEV).action).toBe(
			'block',
		);
		expect(subframeNavigationDecision('https://github.com/x', DEV).action).toBe(
			'external',
		);
	});

	test('neither exception reaches a top-level navigation', () => {
		expect(
			navigationDecision(
				'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html',
				DEV,
			).action,
		).toBe('block');
		expect(
			navigationDecision('blob:http://localhost:5173/abc', DEV).action,
		).toBe('block');
	});
});
