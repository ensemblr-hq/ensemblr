import path from 'node:path';
import { describe, expect, test } from 'vitest';

import {
	APP_BUNDLE_HOST,
	APP_ORIGIN,
	APP_RENDERER_ENTRY_URL,
	APP_SCHEME,
	bundleFilePath,
	documentOrigin,
} from '../../src/main/app/app-bundle';

const BUNDLE_ROOT = '/Applications/Ensemblr.app/Contents/Resources/renderer';

describe('the app scheme addressing', () => {
	test('composes the origin and entry the window is loaded with', () => {
		expect(APP_ORIGIN).toBe(`${APP_SCHEME}://${APP_BUNDLE_HOST}`);
		expect(APP_RENDERER_ENTRY_URL).toBe(`${APP_ORIGIN}/index.html`);
	});
});

// `URL.origin` reports the string "null" for `file:` and for any non-special
// scheme, which is exactly where the mirror and the navigation policy need to
// tell two origins apart.
describe('documentOrigin', () => {
	test('keeps a non-special scheme distinguishable', () => {
		expect(documentOrigin(new URL('app://bundle/index.html'))).toBe(
			'app://bundle',
		);
		expect(documentOrigin(new URL('app://evil/index.html'))).toBe('app://evil');
		expect(documentOrigin(new URL('file:///etc/passwd'))).toBe('file://');
	});

	test('agrees with URL.origin wherever that one works', () => {
		for (const url of ['http://localhost:5173/x', 'https://github.com/a/b']) {
			expect(documentOrigin(new URL(url))).toBe(new URL(url).origin);
		}
	});
});

describe('bundleFilePath', () => {
	test('resolves a bundle asset against the built renderer directory', () => {
		expect(
			bundleFilePath(BUNDLE_ROOT, `${APP_ORIGIN}/assets/index-a1b2c3.js`),
		).toBe(path.join(BUNDLE_ROOT, 'assets/index-a1b2c3.js'));
		expect(bundleFilePath(BUNDLE_ROOT, APP_RENDERER_ENTRY_URL)).toBe(
			path.join(BUNDLE_ROOT, 'index.html'),
		);
	});

	test('serves the entry for a request at the bundle root', () => {
		const entry = path.join(BUNDLE_ROOT, 'index.html');

		expect(bundleFilePath(BUNDLE_ROOT, `${APP_ORIGIN}/`)).toBe(entry);
		expect(bundleFilePath(BUNDLE_ROOT, APP_ORIGIN)).toBe(entry);
	});

	test('drops the query and keeps the path a hash-routed entry asks for', () => {
		expect(
			bundleFilePath(BUNDLE_ROOT, `${APP_RENDERER_ENTRY_URL}?v=1#/workspace/1`),
		).toBe(path.join(BUNDLE_ROOT, 'index.html'));
	});

	// The reason the scheme exists: nothing outside the built bundle is
	// addressable, however the request spells it. Two mechanisms share the work
	// — the URL parser collapses a literal or `%2e`-spelled `..` segment before
	// the pathname is read, and the resolved-path check below catches what
	// survives that because it was smuggled through an encoded separator.
	test('never resolves outside the bundle', () => {
		for (const suffix of [
			'/../../../../Users/me/.ssh/id_ed25519',
			'/assets/../../../../etc/passwd',
			'/%2e%2e/%2e%2e/etc/passwd',
			'/..%2f..%2fetc%2fpasswd',
			'/assets/..%2F..%2F..%2Fetc/passwd',
		]) {
			const resolved = bundleFilePath(BUNDLE_ROOT, `${APP_ORIGIN}${suffix}`);

			expect(resolved === null || resolved.startsWith(`${BUNDLE_ROOT}/`)).toBe(
				true,
			);
		}
	});

	test('refuses an encoded separator that would escape the bundle', () => {
		expect(
			bundleFilePath(BUNDLE_ROOT, `${APP_ORIGIN}/..%2f..%2fetc%2fpasswd`),
		).toBeNull();
	});

	test('refuses any host but the bundle', () => {
		expect(bundleFilePath(BUNDLE_ROOT, `${APP_SCHEME}://evil/index.html`)).toBe(
			null,
		);
		expect(
			bundleFilePath(BUNDLE_ROOT, `${APP_SCHEME}://bundle.evil/index.html`),
		).toBeNull();
	});

	test('refuses another scheme and an unparseable request', () => {
		expect(
			bundleFilePath(BUNDLE_ROOT, `http://${APP_BUNDLE_HOST}/index.html`),
		).toBeNull();
		expect(bundleFilePath(BUNDLE_ROOT, 'file:///etc/passwd')).toBeNull();
		expect(bundleFilePath(BUNDLE_ROOT, 'not a url')).toBeNull();
	});

	test('refuses a malformed percent-escape rather than throwing', () => {
		expect(bundleFilePath(BUNDLE_ROOT, `${APP_ORIGIN}/%E0%A4%A`)).toBeNull();
	});
});
