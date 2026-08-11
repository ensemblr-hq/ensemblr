import { describe, expect, test } from 'vitest';

import {
	dropLinkedDirectoryRecent,
	LINKED_DIRECTORY_RECENTS_LIMIT,
	mergeLinkedDirectoryRecent,
} from '../../src/main/linked-directories/linked-directory-recents.ts';

function entry(path: string, lastUsedAt = '2026-08-11T00:00:00.000Z') {
	return { lastUsedAt, name: path.split('/').pop() ?? path, path };
}

describe('mergeLinkedDirectoryRecent', () => {
	test('puts the directory at the head of an empty list', () => {
		expect(mergeLinkedDirectoryRecent([], entry('/Users/me/designs'))).toEqual([
			entry('/Users/me/designs'),
		]);
	});

	test('moves an already-known directory to the head instead of duplicating it', () => {
		const merged = mergeLinkedDirectoryRecent(
			[entry('/a'), entry('/b'), entry('/c')],
			entry('/c', '2026-08-11T09:00:00.000Z'),
		);

		expect(merged.map((row) => row.path)).toEqual(['/c', '/a', '/b']);
		expect(merged[0]?.lastUsedAt).toBe('2026-08-11T09:00:00.000Z');
	});

	test('caps the list, dropping the least recently used', () => {
		const full = Array.from(
			{ length: LINKED_DIRECTORY_RECENTS_LIMIT },
			(_, i) => entry(`/dir-${i}`),
		);

		const merged = mergeLinkedDirectoryRecent(full, entry('/fresh'));

		expect(merged).toHaveLength(LINKED_DIRECTORY_RECENTS_LIMIT);
		expect(merged[0]?.path).toBe('/fresh');
		expect(merged.map((row) => row.path)).not.toContain(
			`/dir-${LINKED_DIRECTORY_RECENTS_LIMIT - 1}`,
		);
	});

	test('leaves the input list untouched', () => {
		const original = [entry('/a')];

		mergeLinkedDirectoryRecent(original, entry('/b'));

		expect(original).toEqual([entry('/a')]);
	});
});

describe('dropLinkedDirectoryRecent', () => {
	test('removes only the named path', () => {
		expect(
			dropLinkedDirectoryRecent([entry('/a'), entry('/b')], '/a').map(
				(row) => row.path,
			),
		).toEqual(['/b']);
	});

	test('is a no-op for a path that is not in the list', () => {
		expect(
			dropLinkedDirectoryRecent([entry('/a')], '/missing').map(
				(row) => row.path,
			),
		).toEqual(['/a']);
	});
});
