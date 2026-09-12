/// <reference types="node" />

import assert from 'node:assert/strict';
import {
	lstatSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { copyOneFile } from '../../src/main/repository/files-to-copy.ts';

function createDirectory(t: TestContext, prefix: string): string {
	const directory = mkdtempSync(path.join(tmpdir(), prefix));
	t.after(() => rmSync(directory, { force: true, recursive: true }));

	return directory;
}

test('copyOneFile copies a regular file into a fresh destination', (t) => {
	const source = createDirectory(t, 'ensemblr-copy-src-');
	const destination = createDirectory(t, 'ensemblr-copy-dst-');
	writeFileSync(path.join(source, '.env'), 'SECRET=1');

	const outcome = copyOneFile(
		path.join(source, '.env'),
		path.join(destination, 'nested', '.env'),
	);

	assert.equal(outcome.status, 'copied');
	assert.equal(
		readFileSync(path.join(destination, 'nested', '.env'), 'utf8'),
		'SECRET=1',
	);
});

test('copyOneFile refuses a destination the new worktree checked out as a symlink', (t) => {
	const source = createDirectory(t, 'ensemblr-copy-src-');
	const destination = createDirectory(t, 'ensemblr-copy-dst-');
	const victim = path.join(createDirectory(t, 'ensemblr-victim-'), 'zshenv');
	writeFileSync(victim, 'untouched');
	writeFileSync(path.join(source, '.env'), 'SECRET=1');
	symlinkSync(victim, path.join(destination, '.env'));

	const outcome = copyOneFile(
		path.join(source, '.env'),
		path.join(destination, '.env'),
	);

	assert.equal(outcome.status, 'unsafe-destination');
	assert.equal(readFileSync(victim, 'utf8'), 'untouched');
	assert.ok(lstatSync(path.join(destination, '.env')).isSymbolicLink());
});

test('copyOneFile still refuses a source that is not a regular file', (t) => {
	const source = createDirectory(t, 'ensemblr-copy-src-');
	const destination = createDirectory(t, 'ensemblr-copy-dst-');
	const real = path.join(source, 'real');
	writeFileSync(real, 'x');
	symlinkSync(real, path.join(source, 'link'));

	assert.equal(
		copyOneFile(path.join(source, 'link'), path.join(destination, 'link'))
			.status,
		'not-a-file',
	);
	assert.equal(
		copyOneFile(path.join(source, 'gone'), path.join(destination, 'gone'))
			.status,
		'missing',
	);
});
