import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

import { removeDirectoryTree } from '@/main/repository/remove-directory';

const createdRoots: string[] = [];

/** Creates a throwaway directory tree holding `fileCount` nested files. */
function createTree(fileCount: number): string {
	const root = mkdtempSync(path.join(tmpdir(), 'ensemblr-remove-dir-'));
	createdRoots.push(root);

	for (let index = 0; index < fileCount; index += 1) {
		const directory = path.join(root, `nested-${index % 8}`, `deep-${index}`);
		mkdirSync(directory, { recursive: true });
		writeFileSync(path.join(directory, 'file.txt'), `content ${index}`, 'utf8');
	}

	return root;
}

afterEach(() => {
	for (const root of createdRoots.splice(0)) {
		rmSync(root, { force: true, recursive: true });
	}
});

test('removes a nested tree and reports it gone', async () => {
	const root = createTree(64);

	const outcome = await removeDirectoryTree(root);

	expect(outcome.error).toBeNull();
	expect(outcome.removed).toBe(true);
	expect(existsSync(root)).toBe(false);
});

test('reports success for a path that never existed', async () => {
	const root = createTree(1);

	const outcome = await removeDirectoryTree(path.join(root, 'never-here'));

	expect(outcome.error).toBeNull();
	expect(outcome.removed).toBe(true);
});

test('yields to the event loop instead of blocking it', async () => {
	const root = createTree(400);

	let ticks = 0;
	const ticker = setInterval(() => {
		ticks += 1;
	}, 1);

	const outcome = await removeDirectoryTree(root);
	clearInterval(ticker);

	expect(outcome.removed).toBe(true);
	// The synchronous form held the loop for the whole unlink storm, so the timer
	// could not fire once. Any tick at all proves the work moved off-thread.
	expect(ticks).toBeGreaterThan(0);
});
