import { describe, expect, test } from 'vitest';

import { contentSecurityPolicy } from '@/shared/content-security-policy';
import { LINEAR_ASSET_SCHEME } from '@/shared/linear-assets';

/**
 * Reads one directive's source list out of a rendered policy.
 * @param policy - The serialized policy
 * @param name - The directive to read
 * @returns The directive's sources, or an empty array when it is absent
 */
function directive(policy: string, name: string): string[] {
	const found = policy
		.split('; ')
		.find((entry) => entry === name || entry.startsWith(`${name} `));
	return found ? found.split(' ').slice(1) : [];
}

describe('contentSecurityPolicy', () => {
	const PACKAGED = contentSecurityPolicy(null);
	const DEV = contentSecurityPolicy('http://localhost:5173');

	test('starts from default-src none in both forms', () => {
		expect(directive(PACKAGED, 'default-src')).toEqual(["'none'"]);
		expect(directive(DEV, 'default-src')).toEqual(["'none'"]);
	});

	test('never admits a remote script origin', () => {
		for (const policy of [PACKAGED, DEV]) {
			expect(directive(policy, 'script-src')).not.toContain('https:');
			expect(directive(policy, 'script-src')).not.toContain('*');
		}
	});

	test('keeps the dev relaxations out of the packaged build', () => {
		expect(directive(PACKAGED, 'script-src')).not.toContain("'unsafe-inline'");
		expect(directive(PACKAGED, 'connect-src')).toEqual([
			"'self'",
			'data:',
			'blob:',
		]);
		expect(PACKAGED).not.toContain('ws:');
	});

	test('lets the Vite client bootstrap and reconnect in development', () => {
		expect(directive(DEV, 'script-src')).toContain("'unsafe-inline'");
		expect(directive(DEV, 'connect-src')).toContain('ws://localhost:5173');
	});

	// `file:` used to be granted to every fetching directive, because a `file:`
	// document's own assets are cross-origin to it. Serving the packaged renderer
	// from `app://bundle` gives `'self'` something to resolve to, and a policy
	// that no longer names `file:` is what stops a renderer XSS reaching
	// `connect-src` at the user's own files.
	test('names file: in neither serving mode', () => {
		for (const policy of [PACKAGED, DEV]) {
			expect(policy).not.toContain('file:');
		}
	});

	test('grants every fetching directive nothing wider than self', () => {
		for (const name of [
			'script-src',
			'style-src',
			'img-src',
			'font-src',
			'connect-src',
			'worker-src',
		]) {
			expect(directive(PACKAGED, name)).toContain("'self'");
		}
	});

	test('admits exactly the schemes the shipped surfaces need', () => {
		expect(directive(PACKAGED, 'script-src')).toContain("'wasm-unsafe-eval'");
		expect(directive(PACKAGED, 'img-src')).toContain(`${LINEAR_ASSET_SCHEME}:`);
		expect(directive(PACKAGED, 'img-src')).toContain('https:');
		expect(directive(PACKAGED, 'object-src')).toContain('blob:');
		expect(directive(PACKAGED, 'frame-src')).toContain('blob:');
		expect(directive(PACKAGED, 'worker-src')).toContain('blob:');
	});

	test('pins down the navigation-ish directives', () => {
		expect(directive(PACKAGED, 'base-uri')).toEqual(["'none'"]);
		expect(directive(PACKAGED, 'form-action')).toEqual(["'none'"]);
	});

	// Chromium's PDF viewer builds its toolbar from chrome://resources and a
	// plugin document inherits the embedder's policy, so without these the file
	// preview's <embed> instantiates and renders blank.
	test("lets Chromium's own PDF viewer load its UI, in both forms", () => {
		for (const policy of [PACKAGED, DEV]) {
			expect(directive(policy, 'script-src')).toContain('chrome://resources');
			expect(directive(policy, 'style-src')).toContain('chrome://resources');
		}
	});

	// Measured against a real <embed> render: only these two directives needed
	// it. Anything else here would be widening the policy past the evidence.
	test('grants chrome://resources to nothing else', () => {
		for (const name of [
			'default-src',
			'img-src',
			'font-src',
			'media-src',
			'connect-src',
			'worker-src',
			'object-src',
			'frame-src',
		]) {
			expect(directive(PACKAGED, name)).not.toContain('chrome://resources');
			expect(directive(DEV, name)).not.toContain('chrome://resources');
		}
	});
});
