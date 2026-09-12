/// <reference types="node" />

import assert from 'node:assert/strict';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	ensureContainedDirectory,
	isSingleSegment,
	isSymbolicLinkPath,
	writeFileAtomicExclusive,
} from '../../src/main/safe-fs/index.ts';

function createRoot(t: TestContext): string {
	const root = mkdtempSync(path.join(tmpdir(), 'ensemblr-safe-fs-'));
	t.after(() => rmSync(root, { force: true, recursive: true }));

	return root;
}

test('ensureContainedDirectory creates every level and returns the leaf', (t) => {
	const root = createRoot(t);

	const created = ensureContainedDirectory(root, ['.context', 'terminals']);

	assert.equal(created, path.join(root, '.context', 'terminals'));
	assert.ok(existsSync(path.join(root, '.context', 'terminals')));
});

test('ensureContainedDirectory refuses a symlinked first level', (t) => {
	const root = createRoot(t);
	const outside = createRoot(t);
	symlinkSync(outside, path.join(root, '.context'));

	assert.equal(ensureContainedDirectory(root, ['.context', 'terminals']), null);
	assert.equal(readdirSync(outside).length, 0);
});

test('ensureContainedDirectory refuses a symlinked nested level', (t) => {
	const root = createRoot(t);
	const outside = createRoot(t);
	mkdirSync(path.join(root, '.context'));
	symlinkSync(outside, path.join(root, '.context', 'terminals'));

	assert.equal(ensureContainedDirectory(root, ['.context', 'terminals']), null);
	assert.equal(readdirSync(outside).length, 0);
});

test('ensureContainedDirectory refuses a traversal segment', (t) => {
	const root = createRoot(t);

	assert.equal(ensureContainedDirectory(root, ['..', 'escaped']), null);
	assert.equal(ensureContainedDirectory(root, ['a/b']), null);
});

test('ensureContainedDirectory refuses a root that is not on disk', (t) => {
	const root = createRoot(t);

	assert.equal(
		ensureContainedDirectory(path.join(root, 'gone'), ['.context']),
		null,
	);
});

test('isSingleSegment admits a plain name and refuses traversal', () => {
	assert.ok(isSingleSegment('terminals'));
	assert.ok(!isSingleSegment(''));
	assert.ok(!isSingleSegment('..'));
	assert.ok(!isSingleSegment('.'));
	assert.ok(!isSingleSegment('a/b'));
	assert.ok(!isSingleSegment('a\\b'));
});

test('isSymbolicLinkPath distinguishes a link from a regular file', (t) => {
	const root = createRoot(t);
	writeFileSync(path.join(root, 'real'), 'x');
	symlinkSync(path.join(root, 'real'), path.join(root, 'link'));

	assert.ok(isSymbolicLinkPath(path.join(root, 'link')));
	assert.ok(!isSymbolicLinkPath(path.join(root, 'real')));
	assert.ok(!isSymbolicLinkPath(path.join(root, 'absent')));
});

test('writeFileAtomicExclusive replaces a symlinked destination without following it', (t) => {
	const root = createRoot(t);
	const victim = path.join(root, 'victim');
	writeFileSync(victim, 'untouched');
	const target = path.join(root, 'settings.toml');
	symlinkSync(victim, target);

	writeFileAtomicExclusive(target, 'replacement');

	assert.equal(readFileSync(victim, 'utf8'), 'untouched');
	assert.equal(readFileSync(target, 'utf8'), 'replacement');
	assert.ok(!lstatSync(target).isSymbolicLink());
});

test('writeFileAtomicExclusive leaves no temporary file behind', (t) => {
	const root = createRoot(t);

	writeFileAtomicExclusive(path.join(root, 'file.json'), '{}');

	assert.deepEqual(readdirSync(root), ['file.json']);
});
