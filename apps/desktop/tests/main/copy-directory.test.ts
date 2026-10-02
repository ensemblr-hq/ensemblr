import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';

import { copyDirectoryTree } from '@/main/repository/copy-directory';

const createdRoots: string[] = [];

/** Creates a throwaway root directory that is removed after the test. */
function createRoot(): string {
	const root = mkdtempSync(path.join(tmpdir(), 'ensemblr-copy-dir-'));
	createdRoots.push(root);
	return root;
}

afterEach(() => {
	for (const root of createdRoots.splice(0)) {
		rmSync(root, { force: true, recursive: true });
	}
});

test('copies a nested tree', async () => {
	const root = createRoot();
	const source = path.join(root, 'source');
	mkdirSync(path.join(source, 'nested'), { recursive: true });
	writeFileSync(path.join(source, 'nested', 'file.txt'), 'kept', 'utf8');

	const outcome = await copyDirectoryTree(source, path.join(root, 'target'));

	expect(outcome.error).toBeNull();
	expect(
		readFileSync(path.join(root, 'target', 'nested', 'file.txt'), 'utf8'),
	).toBe('kept');
});

test('copies symlinks verbatim instead of following them', async () => {
	const root = createRoot();
	const source = path.join(root, 'source');
	mkdirSync(source, { recursive: true });
	writeFileSync(path.join(source, 'real.txt'), 'real', 'utf8');
	symlinkSync('real.txt', path.join(source, 'link.txt'));

	const outcome = await copyDirectoryTree(source, path.join(root, 'target'));

	expect(outcome.error).toBeNull();
	expect(readFileSync(path.join(root, 'target', 'link.txt'), 'utf8')).toBe(
		'real',
	);
});

test('overwrites an existing target rather than refusing it', async () => {
	const root = createRoot();
	const source = path.join(root, 'source');
	const target = path.join(root, 'target');
	mkdirSync(source, { recursive: true });
	mkdirSync(target, { recursive: true });
	writeFileSync(path.join(source, 'file.txt'), 'new', 'utf8');
	writeFileSync(path.join(target, 'file.txt'), 'old', 'utf8');

	const outcome = await copyDirectoryTree(source, target);

	expect(outcome.error).toBeNull();
	expect(readFileSync(path.join(target, 'file.txt'), 'utf8')).toBe('new');
});

test('reports the failure when the source does not exist', async () => {
	const root = createRoot();

	const outcome = await copyDirectoryTree(
		path.join(root, 'never-here'),
		path.join(root, 'target'),
	);

	expect(outcome.error).not.toBeNull();
	expect(existsSync(path.join(root, 'target'))).toBe(false);
});

// The whole reason this wraps `cp`: the .context/ tree is live while it is
// copied, so a scrollback flush can unlink a file between the walk that listed
// it and the read that would have copied it. One failed attempt is not an answer.
test('retries a walk that failed and reports the copy as clean', async () => {
	const copyTree = vi
		.fn<(source: string, target: string) => Promise<void>>()
		.mockRejectedValueOnce(new Error('ENOENT: rotated.log vanished mid-walk'))
		.mockResolvedValueOnce(undefined);

	const outcome = await copyDirectoryTree('/source', '/target', copyTree);

	expect(outcome.error).toBeNull();
	expect(copyTree).toHaveBeenCalledTimes(2);
	expect(copyTree).toHaveBeenLastCalledWith('/source', '/target');
});

test('gives up after three attempts and reports the last error', async () => {
	const copyTree = vi
		.fn<(source: string, target: string) => Promise<void>>()
		.mockRejectedValueOnce(new Error('first'))
		.mockRejectedValueOnce(new Error('second'))
		.mockRejectedValueOnce(new Error('third'));

	const outcome = await copyDirectoryTree('/source', '/target', copyTree);

	expect(copyTree).toHaveBeenCalledTimes(3);
	expect(outcome.error).toBe('third');
});

test('reports a non-Error throw rather than claiming success', async () => {
	const copyTree = vi
		.fn<(source: string, target: string) => Promise<void>>()
		.mockRejectedValue('nope');

	const outcome = await copyDirectoryTree('/source', '/target', copyTree);

	expect(outcome.error).toBe('Failed to copy the directory.');
});
