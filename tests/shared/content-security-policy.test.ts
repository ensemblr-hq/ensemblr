import { describe, expect, test } from 'vitest';

import { contentSecurityPolicy } from '@/shared/content-security-policy';

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
			'file:',
			'data:',
			'blob:',
		]);
		expect(PACKAGED).not.toContain('ws:');
	});

	test('lets the Vite client bootstrap and reconnect in development', () => {
		expect(directive(DEV, 'script-src')).toContain("'unsafe-inline'");
		expect(directive(DEV, 'connect-src')).toContain('ws://localhost:5173');
	});

	test('grants the packaged file: origin to every fetching directive', () => {
		for (const name of [
			'script-src',
			'style-src',
			'img-src',
			'font-src',
			'connect-src',
			'worker-src',
		]) {
			expect(directive(PACKAGED, name)).toContain('file:');
			expect(directive(DEV, name)).not.toContain('file:');
		}
	});

	test('admits exactly the schemes the shipped surfaces need', () => {
		expect(directive(PACKAGED, 'script-src')).toContain("'wasm-unsafe-eval'");
		expect(directive(PACKAGED, 'img-src')).toContain('linear-asset:');
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
