import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { externalHref, parseExternalUrl } from '@/renderer/lib/external-url';

const ACCEPTED = [
	'https://ensemblr.dev',
	'https://ensemblr.dev/schemas/settings.schema.json?v=1#top',
	'http://localhost:3000',
	'http://127.0.0.1:5173/path',
];

const REFUSED = [
	'javascript:alert(1)',
	'JavaScript:alert(1)',
	'  javascript:alert(1)',
	'data:text/html,<script>alert(1)</script>',
	'file:///etc/passwd',
	'blob:https://ensemblr.dev/abc',
	'smb://host/share',
	'vscode://file/etc/passwd',
	'itms-services://?action=download-manifest',
	'not a url',
	'/relative/path',
	'',
];

describe('parseExternalUrl', () => {
	it('accepts http and https', () => {
		for (const url of ACCEPTED) {
			expect(parseExternalUrl(url), url).not.toBeNull();
		}
	});

	it('refuses every other scheme and anything unparseable', () => {
		for (const url of REFUSED) {
			expect(parseExternalUrl(url), url).toBeNull();
		}
	});

	it('refuses nullish input', () => {
		expect(parseExternalUrl(null)).toBeNull();
		expect(parseExternalUrl(undefined)).toBeNull();
	});
});

describe('externalHref', () => {
	// A rewritten URL is a changed destination; `new URL().href` normalizes an
	// empty path to `/` and reorders nothing else, but the anchor should carry
	// exactly what the provider sent.
	it('hands an accepted URL back verbatim', () => {
		for (const url of ACCEPTED) {
			expect(externalHref(url), url).toBe(url);
		}
	});

	it('returns undefined for a refused URL so the anchor renders as text', () => {
		for (const url of REFUSED) {
			expect(externalHref(url), url).toBeUndefined();
		}
	});
});

// The renderer cannot import the main-process module across the process
// boundary, so the two allowlists are kept honest by comparing their source.
describe('parity with the main-process policy', () => {
	it('allows exactly the schemes src/main/app/external-links-policy.ts does', () => {
		const read = (path: string) =>
			readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
		const schemes = (source: string) =>
			source.match(/ALLOWED_EXTERNAL_PROTOCOLS = new Set\(\[([^\]]*)\]\)/)?.[1];

		expect(schemes(read('../../src/renderer/lib/external-url/index.ts'))).toBe(
			schemes(read('../../src/main/app/external-links-policy.ts')),
		);
	});
});
