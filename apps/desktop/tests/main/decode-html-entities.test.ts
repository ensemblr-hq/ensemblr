import { describe, expect, test } from 'vitest';

import { decodeHtmlEntities } from '../../src/main/agent-runtime/naming/decode-html-entities';

describe('decodeHtmlEntities', () => {
	test('decodes the predefined named entities', () => {
		expect(decodeHtmlEntities('Admin &amp; Management')).toBe(
			'Admin & Management',
		);
		expect(decodeHtmlEntities('Compare &lt;div&gt; output')).toBe(
			'Compare <div> output',
		);
		expect(decodeHtmlEntities('Quote the &quot;title&quot;')).toBe(
			'Quote the "title"',
		);
		expect(decodeHtmlEntities('It&#39;s fixed')).toBe("It's fixed");
		expect(decodeHtmlEntities('It&apos;s fixed')).toBe("It's fixed");
	});

	test('decodes a non-breaking space to U+00A0', () => {
		expect(decodeHtmlEntities('Admin&nbsp;panel')).toBe('Admin panel');
	});

	test('decodes decimal and hexadecimal numeric forms', () => {
		expect(decodeHtmlEntities('Admin &#38; Management')).toBe(
			'Admin & Management',
		);
		expect(decodeHtmlEntities('Admin &#x26; Management')).toBe(
			'Admin & Management',
		);
		expect(decodeHtmlEntities('Admin &#X26; Management')).toBe(
			'Admin & Management',
		);
	});

	test('decodes a code point outside the BMP', () => {
		expect(decodeHtmlEntities('Ship &#x1F600; it')).toBe('Ship \u{1f600} it');
	});

	test('decodes repeatedly-escaped input down to one character', () => {
		expect(decodeHtmlEntities('Admin &amp;amp; Management')).toBe(
			'Admin & Management',
		);
		expect(decodeHtmlEntities('Admin &amp;amp;amp; Management')).toBe(
			'Admin & Management',
		);
	});

	test('reaches the fixpoint however deeply the input was escaped', () => {
		const nested = `Admin &${'amp;'.repeat(64)} Management`;
		expect(decodeHtmlEntities(nested)).toBe('Admin & Management');
	});

	test('decodes sibling entities in a single pass', () => {
		expect(decodeHtmlEntities('&amp;&amp;&amp;')).toBe('&&&');
	});

	test('is idempotent, so no entity survives a decoded result', () => {
		for (const input of [
			'Admin &amp;amp;amp;amp;amp;amp; Management',
			'Compare &amp;lt;div&amp;gt; output',
			'Admin &amp; Management',
		]) {
			const once = decodeHtmlEntities(input);
			expect(decodeHtmlEntities(once)).toBe(once);
		}
	});

	test('leaves a bare ampersand untouched', () => {
		expect(decodeHtmlEntities('Admin & Management')).toBe('Admin & Management');
		expect(decodeHtmlEntities('Tom & Jerry & Co')).toBe('Tom & Jerry & Co');
	});

	test('leaves an unterminated or unknown entity as written', () => {
		expect(decodeHtmlEntities('Fix &amp login')).toBe('Fix &amp login');
		expect(decodeHtmlEntities('Fix &notarealentity; login')).toBe(
			'Fix &notarealentity; login',
		);
		expect(decodeHtmlEntities('Fix &#; login')).toBe('Fix &#; login');
	});

	test('refuses code points a title or branch name must not carry', () => {
		expect(decodeHtmlEntities('Fix&#0;login')).toBe('Fix&#0;login');
		expect(decodeHtmlEntities('Fix&#7;login')).toBe('Fix&#7;login');
		expect(decodeHtmlEntities('Fix&#xD800;login')).toBe('Fix&#xD800;login');
		expect(decodeHtmlEntities('Fix&#1114112;login')).toBe('Fix&#1114112;login');
	});

	test('decodes a whitespace control to a plain space, never a line break', () => {
		expect(decodeHtmlEntities('Fix&#10;login')).toBe('Fix login');
		expect(decodeHtmlEntities('Fix&#13;login')).toBe('Fix login');
		expect(decodeHtmlEntities('Fix&#9;login')).toBe('Fix login');
		expect(decodeHtmlEntities('Fix&#x0A;login')).toBe('Fix login');
	});

	test('leaves no entity fragment behind for a decoded whitespace control', () => {
		expect(decodeHtmlEntities('Fix&#10;login')).not.toMatch(/10/);
	});

	test('returns text without entities unchanged', () => {
		expect(decodeHtmlEntities('')).toBe('');
		expect(decodeHtmlEntities('Fix login redirect')).toBe('Fix login redirect');
	});
});
