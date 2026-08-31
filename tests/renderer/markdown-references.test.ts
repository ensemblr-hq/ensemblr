import { describe, expect, test } from 'vitest';

import {
	documentBaseDirectory,
	documentReferenceLookupPath,
	isLocalFileReference,
	staysInsideWorkspace,
} from '@/renderer/lib/markdown-references';

describe('isLocalFileReference', () => {
	test.each([
		'./02-requirements.md',
		'../../docs/adr/0047-attachments.md',
		'images/a.png',
		'/docs/guide/a.png',
		'a file with spaces.md',
	])('takes %s for a path', (reference) => {
		expect(isLocalFileReference(reference)).toBe(true);
	});

	test.each([
		'https://example.com/a.png',
		'http://example.com',
		'mailto:someone@example.com',
		'ensemblr:workspace/ws-1',
		'ensemblr-linear-asset://acct/uploads/a.png',
		'data:image/png;base64,AAAA',
		'//example.com/a.png',
		'#a-heading',
		'   ',
	])('leaves %s to whoever already renders it', (reference) => {
		expect(isLocalFileReference(reference)).toBe(false);
	});
});

describe('documentReferenceLookupPath', () => {
	test('anchors a relative reference on the document directory', () => {
		expect(documentReferenceLookupPath('./images/a.png', 'docs/guide')).toBe(
			'docs/guide/./images/a.png',
		);
	});

	test('anchors a climb too, leaving the resolver to normalize it', () => {
		expect(documentReferenceLookupPath('../adr/0001.md', 'docs/guide')).toBe(
			'docs/guide/../adr/0001.md',
		);
	});

	test('leaves an absolute or home-relative reference where it points', () => {
		expect(documentReferenceLookupPath('/tmp/a.png', 'docs/guide')).toBe(
			'/tmp/a.png',
		);
		expect(documentReferenceLookupPath('~/notes/a.md', 'docs/guide')).toBe(
			'~/notes/a.md',
		);
	});

	test('has nothing to join for a document at the workspace root', () => {
		expect(documentReferenceLookupPath('./a.png', '')).toBe('./a.png');
	});

	test('drops the query and fragment a link carries', () => {
		expect(documentReferenceLookupPath('./a.md#section', 'docs')).toBe(
			'docs/./a.md',
		);
		expect(documentReferenceLookupPath('./a.png?v=2', 'docs')).toBe(
			'docs/./a.png',
		);
	});

	test('decodes the escapes an author writes for a space', () => {
		expect(documentReferenceLookupPath('./my%20file.md', 'docs')).toBe(
			'docs/./my file.md',
		);
	});

	test('leaves a malformed escape as written rather than throwing', () => {
		expect(documentReferenceLookupPath('./100%.md', 'docs')).toBe(
			'docs/./100%.md',
		);
	});

	test('resolves to nothing for a reference that is only a fragment', () => {
		expect(documentReferenceLookupPath('#section', 'docs')).toBe('');
	});
});

describe('staysInsideWorkspace', () => {
	test.each([
		'docs/guide/./images/a.png',
		'docs/guide/../adr/0001.md',
		'README.md',
		'docs/guide/../../README.md',
	])('takes %s for a path the preview may read unprompted', (lookupPath) => {
		expect(staysInsideWorkspace(lookupPath)).toBe(true);
	});

	test.each([
		'/etc/passwd',
		'~/.aws/credentials',
		'docs/guide/../../../etc/passwd',
		'docs/guide/../../../../../../etc/passwd',
		'..',
		'docs/..',
		'',
	])('refuses %s, which leaves the workspace', (lookupPath) => {
		expect(staysInsideWorkspace(lookupPath)).toBe(false);
	});
});

describe('documentBaseDirectory', () => {
	test('is the parent of the document', () => {
		expect(documentBaseDirectory('docs/guide/03-first-run.md')).toBe(
			'docs/guide',
		);
	});

	test('is empty for a document at the workspace root', () => {
		expect(documentBaseDirectory('README.md')).toBe('');
	});

	test('keeps the leading slash of an external document', () => {
		expect(documentBaseDirectory('/Users/me/notes/a.md')).toBe(
			'/Users/me/notes',
		);
	});
});
