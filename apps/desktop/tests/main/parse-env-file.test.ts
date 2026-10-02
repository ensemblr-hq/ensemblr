import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	loadEnvFile,
	parseEnvFileContents,
} from '../../src/main/environment/parse-env-file.ts';

test('parses assignments, export prefixes, comments, and blank lines', () => {
	const result = parseEnvFileContents(
		[
			'# a comment',
			'',
			'PLAIN=value',
			'export EXPORTED=exported-value',
			'  SPACED  =  spaced-value  ',
		].join('\n'),
	);

	assert.deepEqual(result, {
		EXPORTED: 'exported-value',
		PLAIN: 'value',
		SPACED: 'spaced-value',
	});
});

test('strips quotes and expands escapes inside double quotes', () => {
	const result = parseEnvFileContents(
		['DOUBLE="line1\\nline2"', "SINGLE='raw\\nvalue'", 'BARE=plain'].join('\n'),
	);

	assert.equal(result.DOUBLE, 'line1\nline2');
	assert.equal(result.SINGLE, 'raw\\nvalue');
	assert.equal(result.BARE, 'plain');
});

test('ignores invalid keys and lines without a separator', () => {
	const result = parseEnvFileContents(
		['1BAD=skip', 'BAD-NAME=skip', 'NOEQUALS', 'GOOD=keep'].join('\n'),
	);

	assert.deepEqual(result, { GOOD: 'keep' });
});

test('loadEnvFile reads a file and reports a missing path', (t: TestContext) => {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-parse-env-'));
	const filePath = path.join(directory, '.env');
	writeFileSync(filePath, 'A=1\nB=2\n', 'utf8');

	t.after(() => {
		rmSync(directory, { force: true, recursive: true });
	});

	assert.deepEqual(loadEnvFile(filePath), { values: { A: '1', B: '2' } });

	const missing = loadEnvFile(path.join(directory, 'nope.env'));
	assert.deepEqual(missing.values, {});
	assert.equal(typeof missing.error, 'string');
});
