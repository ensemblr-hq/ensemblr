/**
 * `withListKeys` is what four rendered lists use instead of an array index, so
 * the property that matters is the one an index does not have: a key stays with
 * its item when the list around it shifts.
 */

import { describe, expect, test } from 'vitest';

import { withListKeys } from '../../src/renderer/lib/list-keys';

const identity = (value: string) => value;

describe('withListKeys', () => {
	test('keeps the items in render order', () => {
		const keyed = withListKeys(['a', 'b', 'c'], identity);

		expect(keyed.map(({ item }) => item)).toEqual(['a', 'b', 'c']);
	});

	test('tells repeated content apart', () => {
		const keyed = withListKeys(['frame', 'frame', 'frame'], identity);
		const keys = keyed.map(({ key }) => key);

		expect(new Set(keys).size).toBe(3);
	});

	test('holds a key to its item when the list is prepended to', () => {
		const before = withListKeys(['a', 'b'], identity);
		const after = withListKeys(['z', 'a', 'b'], identity);

		expect(after.at(-1)?.key).toBe(before.at(-1)?.key);
	});

	test('holds a repeat to its position when an earlier twin is removed', () => {
		const before = withListKeys(['dup', 'dup'], identity);
		const after = withListKeys(['dup'], identity);

		expect(after[0].key).toBe(before[0].key);
	});

	test('derives the key from the identity rather than the item', () => {
		const keyed = withListKeys(
			[{ path: '/a.ts' }, { path: '/a.ts' }],
			(frame) => frame.path,
		);

		expect(keyed[0].key).toContain('/a.ts');
		expect(keyed[0].key).not.toBe(keyed[1].key);
	});

	test('returns nothing for an empty list', () => {
		expect(withListKeys([], identity)).toEqual([]);
	});
});
