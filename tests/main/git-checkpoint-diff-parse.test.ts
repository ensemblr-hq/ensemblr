import { describe, expect, test } from 'vitest';

import { parseCombinedDiff } from '../../src/main/checkpoints/git-checkpoint.ts';

/**
 * Real `git diff -M --raw --numstat --patch` output, captured from a repository
 * holding one file of each kind the parse has to tell apart: an addition, a
 * deletion, a modification, and a rename that git detected with `-M`.
 *
 * The rename is the case that matters. `--raw` names the destination path,
 * `--numstat` names the pair as `old => new` in a single field — so a parse that
 * joins the two sections on the path string finds nothing for a rename and
 * reports it as a plain modification, which is what this repository did while
 * the two were separate `git diff` invocations.
 */
const COMBINED = [
	':000000 100644 0000000 92d5444 A\tfresh.txt',
	':100644 000000 286c5f5 0000000 D\tgone.txt',
	':100644 100644 bd93009 a0a5694 M\tkept.txt',
	':100644 100644 600d48a a3fb829 R086\told-name.txt\tnew-name.txt',
	'1\t0\tfresh.txt',
	'0\t1\tgone.txt',
	'1\t0\tkept.txt',
	'1\t0\told-name.txt => new-name.txt',
	'',
	'diff --git a/fresh.txt b/fresh.txt',
	'new file mode 100644',
	'--- /dev/null',
	'+++ b/fresh.txt',
	'@@ -0,0 +1 @@',
	'+fresh',
].join('\n');

describe('parseCombinedDiff', () => {
	test('reads status and counts out of one stream', () => {
		expect(parseCombinedDiff(COMBINED).files).toEqual([
			{ additions: 1, deletions: 0, path: 'fresh.txt', status: 'added' },
			{ additions: 0, deletions: 1, path: 'gone.txt', status: 'deleted' },
			{ additions: 1, deletions: 0, path: 'kept.txt', status: 'modified' },
			{ additions: 1, deletions: 0, path: 'new-name.txt', status: 'renamed' },
		]);
	});

	test('gives a rename its destination path and its real status', () => {
		const renamed = parseCombinedDiff(COMBINED).files.at(-1);

		expect(renamed?.status).toBe('renamed');
		expect(renamed?.path).toBe('new-name.txt');
	});

	test('keeps the patch whole, from the first header to the last line', () => {
		const { patch } = parseCombinedDiff(COMBINED);

		expect(patch.startsWith('diff --git a/fresh.txt b/fresh.txt')).toBe(true);
		expect(patch.endsWith('+fresh')).toBe(true);
		expect(patch).not.toContain('\t');
	});

	test('reports a binary file as unknown counts rather than zero', () => {
		const binary = [
			':100644 100644 aaaaaaa bbbbbbb M\tlogo.png',
			'-\t-\tlogo.png',
		].join('\n');

		expect(parseCombinedDiff(binary).files).toEqual([
			{
				additions: null,
				deletions: null,
				path: 'logo.png',
				status: 'modified',
			},
		]);
	});

	test('an empty diff is no files and no patch', () => {
		expect(parseCombinedDiff('')).toEqual({ files: [], patch: '' });
	});
});
