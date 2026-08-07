import { describe, expect, test } from 'vitest';

import {
	newLineNumberOf,
	oldLineNumberOf,
	parseSingleFileDiff,
	reconstructOldSource,
	reconstructSideSources,
	resolveChangeKey,
	splitCombinedPatch,
} from '../../src/renderer/lib/diff/parse';

const MODIFY_PATCH = `diff --git a/foo.ts b/foo.ts
index 1111111..2222222 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,4 +1,4 @@
 line1
-line2old
+line2new
 line3
 line4
`;

const SECOND_PATCH = `diff --git a/bar.ts b/bar.ts
index 3333333..4444444 100644
--- a/bar.ts
+++ b/bar.ts
@@ -1,2 +1,3 @@
 keep
+added
 tail
`;

describe('parseSingleFileDiff', () => {
	test('parses a single modify patch into one file with hunks', () => {
		const file = parseSingleFileDiff(MODIFY_PATCH);
		expect(file?.newPath).toBe('foo.ts');
		expect(file?.hunks).toHaveLength(1);
	});

	test('returns null for empty input', () => {
		expect(parseSingleFileDiff('   ')).toBeNull();
	});
});

describe('reconstructSideSources', () => {
	test('places each side line at its true line number', () => {
		const file = parseSingleFileDiff(MODIFY_PATCH);
		const { oldText, newText } = reconstructSideSources(file?.hunks ?? []);
		expect(oldText).toBe('line1\nline2old\nline3\nline4');
		expect(newText).toBe('line1\nline2new\nline3\nline4');
	});
});

describe('reconstructOldSource', () => {
	test('reverse-applies hunks to recover the base file', () => {
		const file = parseSingleFileDiff(MODIFY_PATCH);
		const newContent = 'line1\nline2new\nline3\nline4';
		expect(reconstructOldSource(newContent, file?.hunks ?? [])).toBe(
			'line1\nline2old\nline3\nline4',
		);
	});

	test('drops an inserted line when reconstructing the base', () => {
		const file = parseSingleFileDiff(SECOND_PATCH);
		const newContent = 'keep\nadded\ntail';
		expect(reconstructOldSource(newContent, file?.hunks ?? [])).toBe(
			'keep\ntail',
		);
	});
});

describe('splitCombinedPatch', () => {
	test('splits a combined patch into per-file slices', () => {
		const files = splitCombinedPatch(`${MODIFY_PATCH}${SECOND_PATCH}`);
		expect(files.map((file) => file.path)).toEqual(['foo.ts', 'bar.ts']);
		expect(files[0].patch.startsWith('diff --git a/foo.ts')).toBe(true);
	});

	test('returns an empty list for blank input', () => {
		expect(splitCombinedPatch('')).toEqual([]);
	});
});

describe('line-number accessors', () => {
	test('reads old and new line numbers per change type', () => {
		const file = parseSingleFileDiff(MODIFY_PATCH);
		const changes = file?.hunks[0]?.changes ?? [];
		const insert = changes.find((change) => change.type === 'insert');
		const del = changes.find((change) => change.type === 'delete');
		expect(insert && oldLineNumberOf(insert)).toBeNull();
		expect(insert && newLineNumberOf(insert)).toBe(2);
		expect(del && newLineNumberOf(del)).toBeNull();
		expect(del && oldLineNumberOf(del)).toBe(2);
	});
});

const RESOLVE_PATCH = `diff --git a/f.ts b/f.ts
index 111..222 100644
--- a/f.ts
+++ b/f.ts
@@ -1,3 +1,4 @@
 export const x = 1;
+export const y = 2;
 const z = x + 1;
 console.log(z);
`;

describe('resolveChangeKey', () => {
	const hunks = parseSingleFileDiff(RESOLVE_PATCH)?.hunks ?? [];

	test('resolves an inserted line on the side it was asked for', () => {
		expect(resolveChangeKey(hunks, 2, 'new')).toBe('I2');
	});

	// A comment filed against the new side can still name a line that only exists
	// on the old one, so the lookup falls back rather than losing the anchor.
	test('falls back to the other side when the requested one misses', () => {
		expect(resolveChangeKey(hunks, 1, 'old')).not.toBeNull();
	});

	test('returns null for a line no hunk covers', () => {
		expect(resolveChangeKey(hunks, 999, 'new')).toBeNull();
	});
});
