import { describe, expect, test } from 'vitest';

import { parseNumberedFileBody } from '../../src/renderer/lib/agent-timeline/numbered-file-body';

describe('parseNumberedFileBody', () => {
	test('strips a tab-separated gutter and reports its first line', () => {
		expect(
			parseNumberedFileBody('    11\tconst a = 1;\n    12\tconst b = 2;'),
		).toEqual({
			code: 'const a = 1;\nconst b = 2;',
			startLine: 11,
		});
	});

	test('strips an arrow-separated gutter', () => {
		expect(parseNumberedFileBody('1→#!/usr/bin/env node')).toEqual({
			code: '#!/usr/bin/env node',
			startLine: 1,
		});
	});

	test('keeps a trailing newline so the line count is unchanged', () => {
		expect(parseNumberedFileBody('1\ta\n2\tb\n')).toEqual({
			code: 'a\nb\n',
			startLine: 1,
		});
	});

	test('keeps the blank lines a gutter still numbers', () => {
		expect(parseNumberedFileBody('7\ta\n8\t\n9\tb')).toEqual({
			code: 'a\n\nb',
			startLine: 7,
		});
	});

	test('leaves unnumbered output alone', () => {
		expect(parseNumberedFileBody('# Ensemblr\n\nA desktop app.')).toBeNull();
	});

	test('leaves output whose numbers do not run consecutively alone', () => {
		expect(parseNumberedFileBody('1\tred\t#f00\n3\tblue\t#00f')).toBeNull();
	});

	test('drops the harness chatter appended after the body', () => {
		expect(
			parseNumberedFileBody(
				'1\ta\n2\tb\n<system-reminder>empty</system-reminder>',
			),
		).toEqual({ code: 'a\nb\n', startLine: 1 });
	});

	test('drops a multi-line notice appended after the body', () => {
		expect(
			parseNumberedFileBody('12\ta\n13\tb\n\nFile truncated at 2000 lines.\n'),
		).toEqual({ code: 'a\nb\n', startLine: 12 });
	});

	test('leaves output alone when the numbering resumes after the tail', () => {
		expect(parseNumberedFileBody('1\ta\nnote\n7\tb')).toBeNull();
	});

	test('leaves output alone when the first line lacks a number', () => {
		expect(parseNumberedFileBody('Reading src/app.tsx\n1\ta\n2\tb')).toBeNull();
	});

	test('reads no body out of an empty result', () => {
		expect(parseNumberedFileBody('')).toBeNull();
	});
});
